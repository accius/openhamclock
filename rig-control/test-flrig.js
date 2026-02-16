const xmlrpc = require("xmlrpc");

const HOST = "127.0.0.1";
const PORT = 12345;

const client = xmlrpc.createClient({ host: HOST, port: PORT, path: "/" });

console.log(`Connecting to flrig at ${HOST}:${PORT}...`);

// Test 1: Get Frequency (Should work)
client.methodCall("rig.get_vfo", [], (err, val) => {
  if (err) {
    console.error("get_vfo failed:", err);
  } else {
    console.log("Current Freq:", val);

    // Test 2: Set Freq (Integer) - Might fail
    const targetInt = 14075000;
    console.log(`Attempting to set Integer Freq: ${targetInt}`);
    client.methodCall("rig.set_frequency", [targetInt], (err2, val2) => {
      if (err2) console.error("Set Int failed:", err2);
      else console.log("Set Int result:", val2);
    });

    // Test 3: Set Freq (Double) - Should work
    const targetDouble = 14076000.1;
    console.log(`Attempting to set Double Freq: ${targetDouble}`);
    client.methodCall("rig.set_frequency", [targetDouble], (err3, val3) => {
      if (err3) console.error("Set Double failed:", err3);
      else console.log("Set Double result:", val3);
    });
  }
});
