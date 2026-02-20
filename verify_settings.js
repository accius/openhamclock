const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

console.log('Starting verification...');

// Start the server
const server = spawn('node', ['server.js'], {
  cwd: '/home/x/openhamclock',
  env: { ...process.env, PORT: '3001', SETTINGS_SYNC: 'true', API_WRITE_KEY: 'testkey' },
});

server.stdout.on('data', (data) => {
  // console.log(`stdout: ${data}`);
});

server.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});

async function verify() {
  // Wait for server manually
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const api = 'http://localhost:3001/api/settings';
  const headers = { Authorization: 'Bearer testkey', 'Content-Type': 'application/json' };

  try {
    // 1. Client A: Save settings
    console.log('Test 1: Client A saves settings');
    const resA = await fetch(api, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_id: 'client-a',
        openhamclock_theme: 'dark',
      }),
    });
    const dataA = await resA.json();
    console.log('Client A Save Result:', dataA);

    // 2. Client B: Save different settings
    console.log('Test 2: Client B saves settings');
    const resB = await fetch(api, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_id: 'client-b',
        openhamclock_theme: 'light',
      }),
    });
    const dataB = await resB.json();
    console.log('Client B Save Result:', dataB);

    // 3. Verify Client A gets 'dark'
    console.log('Test 3: Verify Client A settings');
    const getA = await fetch(`${api}?client_id=client-a`);
    const settingsA = await getA.json();
    console.log('Client A Settings:', settingsA.openhamclock_theme);

    // 4. Verify Client B gets 'light'
    console.log('Test 4: Verify Client B settings');
    const getB = await fetch(`${api}?client_id=client-b`);
    const settingsB = await getB.json();
    console.log('Client B Settings:', settingsB.openhamclock_theme);

    // 5. Verify Isolation
    if (settingsA.openhamclock_theme === 'dark' && settingsB.openhamclock_theme === 'light') {
      console.log('SUCCESS: Settings are isolated by client_id!');
    } else {
      console.error('FAILURE: Settings are not isolated!');
    }
  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    server.kill();
    process.exit(0);
  }
}

verify();
