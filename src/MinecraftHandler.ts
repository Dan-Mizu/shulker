import fs from "fs";
import path from "path";
import { Tail } from "tail";
import express from "express";

import type { Config } from "./Config";

import { fixMinecraftUsername } from "./lib/util";

export type LogLine = {
	username: string;
	message: string;
} | null;

type Callback = (data: LogLine) => void;

class MinecraftHandler {
	config: Config;

	app: express.Application;
	tail: Tail;

	constructor(config: Config) {
		this.config = config;
	}

	private parseLogLine(data: string): LogLine {
		// DEBUG
		if (this.config.DEBUG) console.log("[DEBUG] Received " + data);

		// get server prefix regex
		const logLineDataRegex = new RegExp(
			`${
				this.config.REGEX_SERVER_PREFIX || "\\[Server thread/INFO\\]:"
			} (.*)`
		);

		// get the part after the log prefix, so all the actual data is here
		const logLineData = data.match(logLineDataRegex);

		// check if log line has correct server prefix
		if (!logLineDataRegex.test(data) || !logLineData) {
			if (this.config.DEBUG) {
				console.log("[DEBUG] Regex could not match the string:");
				console.log(
					'Received: "' +
						data +
						'", Regex matches lines that start with: "' +
						this.config.REGEX_SERVER_PREFIX +
						'"'
				);
			}
			return null;
		}

		// get log line
		const logLine = logLineData[1];

		// // the username used for server messages
		// const serverUsername = `${this.config.SERVER_NAME} - Server`;

		// chat message
		if (logLine.startsWith("<")) {
			if (this.config.DEBUG) {
				console.log("[DEBUG] A player sent a chat message");
			}

			const re = new RegExp(this.config.REGEX_MATCH_CHAT_MC);
			const matches = logLine.match(re);

			if (!matches) {
				console.log("[ERROR] Could not parse message: " + logLine);
				return null;
			}

			const username = fixMinecraftUsername(
				matches[1].split(" ").pop() as string
			);
			const message = matches[2];
			if (this.config.DEBUG) {
				console.log("[DEBUG] Username: " + matches[1]);
				console.log("[DEBUG] Text: " + matches[2]);
			}
			return { username, message };
		}

		// /me command message
		else if (logLine.startsWith("* ")) {
			// check if enabled
			if (!this.config.SHOW_PLAYER_ME) return null;

			// /me commands have the bolded name and the action they did
			const usernameMatch = data.match(/: \* ([a-zA-Z0-9_]{1,16}) (.*)/);
			if (usernameMatch) {
				const username = usernameMatch[1];
				const rest = usernameMatch[2];
				return {
					username: username,
					message: `*${rest}*`,
				};
			}
			return null;
		}

		// // server command messages
		// else if (logLine.startsWith("[")) {
		// }

		// fallback
		else {
			// // check blacklist
			// const ignored = new RegExp(this.config.REGEX_IGNORED_CHAT);
			// if (ignored.test(data)) {
			// 	if (this.config.DEBUG) console.log("[DEBUG] Line ignored");
			// 	return null;
			// }

			// check whitelist
			const whitelist = new RegExp(this.config.REGEX_WHITELISTED_CONSOLE);
			if (whitelist.test(data)) {
				if (this.config.DEBUG) {
					console.log(`[DEBUG] A server message was sent: ${data}`);
				}

				return {
					username: this.config.SERVER_NAME,
					message: logLine,
				};
			}
		}

		return null;
	}

	private initWebServer(callback: Callback) {
		// init the webserver
		this.app = express();

		this.app.use((request, _response, next) => {
			request.rawBody = "";
			request.setEncoding("utf8");

			request.on("data", (chunk: string) => {
				request.rawBody += chunk;
			});

			request.on("end", function () {
				next();
			});
		});

		this.app.post(this.config.WEBHOOK, (req, res) => {
			if (req.rawBody) {
				const logLine = this.parseLogLine(req.rawBody);
				callback(logLine);
			}
			res.json({ received: true });
		});

		const port: number = Number(process.env.PORT) || this.config.PORT;

		this.app.listen(port, () => {
			console.log("[INFO] Bot listening on *:" + port);

			if (!this.config.IS_LOCAL_FILE && this.config.SHOW_INIT_MESSAGE) {
				// in case someone inputs the actual path and url in the config here...
				let mcPath: string =
					this.config.PATH_TO_MINECRAFT_SERVER_INSTALL ||
					"PATH_TO_MINECRAFT_SERVER_INSTALL";
				const url: string = this.config.YOUR_URL || "YOUR_URL";

				const defaultPath =
					mcPath === "PATH_TO_MINECRAFT_SERVER_INSTALL";
				const defaultUrl = url === "YOUR_URL";

				console.log(
					"[INFO] Please enter the following command on your server running the Minecraft server:"
				);
				if (defaultPath) {
					console.log(
						'       Replace "PATH_TO_MINECRAFT_SERVER_INSTALL" with the path to your Minecraft server install' +
							(defaultUrl
								? ' and "YOUR_URL" with the URL/IP of the server running Shulker.'
								: "")
					);
				} else {
					if (defaultUrl)
						console.log(
							'       Replace "YOUR_URL" with the URL/IP of the server running Shulker'
						);
				}

				mcPath =
					(defaultPath ? "/" : "") +
					path.join(mcPath, "/logs/latest.log");

				let grepMatch = ": <";
				if (
					// this.config.SHOW_PLAYER_DEATH ||
					this.config.SHOW_PLAYER_ME
					// || this.config.SHOW_PLAYER_ADVANCEMENT ||
					// this.config.SHOW_PLAYER_CONN_STAT
				) {
					grepMatch = this.config.REGEX_SERVER_PREFIX;
				}
				console.log(
					`  \`tail -F ${mcPath} | grep -P --line-buffered "${grepMatch}" | while IFS= read -r x; do printf '%s\\n' "$x" | curl -X POST -d @- http://${url}:${port}${this.config.WEBHOOK} ; done\``
				);
				if (grepMatch !== ": <") {
					console.log(
						'       Please note that the above command can send a lot of requests to the server. Disable the non-text messages (such as "SHOW_PLAYER_CONN_STAT") to reduce this if necessary.'
					);
				}
			}
		});
	}

	private initTail(callback: Callback) {
		if (fs.existsSync(this.config.LOCAL_FILE_PATH)) {
			console.log(
				`[INFO] Using configuration for local log file at "${this.config.LOCAL_FILE_PATH}"`
			);
			this.tail = new Tail(this.config.LOCAL_FILE_PATH, {
				useWatchFile: this.config.FS_WATCH_FILE ?? true,
			});
		} else {
			throw new Error(
				`[ERROR] Local log file not found at "${this.config.LOCAL_FILE_PATH}"`
			);
		}
		this.tail.on("line", (data: string) => {
			// Parse the line to see if we care about it
			let logLine = this.parseLogLine(data);
			if (data) {
				callback(logLine);
			}
		});
		this.tail.on("error", (error: any) => {
			console.log("[ERROR] Error tailing log file: " + error);
		});
	}

	public init(callback: Callback) {
		if (this.config.IS_LOCAL_FILE) {
			this.initTail(callback);
		} else {
			this.initWebServer(callback);
		}
	}
}

export default MinecraftHandler;
