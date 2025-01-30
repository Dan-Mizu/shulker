import Shulker from "./Shulker";

// add timestamp to all console logging
var originalLog = console.log;
console.log = function (obj, ...placeholders) {
	// get timestamp
	const now = new Date();
	const timestamp = `[${now.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})}]`;

	// string input
	if (typeof obj === "string") placeholders.unshift(timestamp + " " + obj);
	// object input
	else {
		placeholders.unshift(obj);
		placeholders.unshift(timestamp + " %j");
	}

	originalLog.apply(this, placeholders);
};

const main = async () => {
	const shulker = new Shulker();
	await shulker.init();
};

main();
