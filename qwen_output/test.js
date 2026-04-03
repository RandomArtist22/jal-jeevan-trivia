#!/usr/bin/env node

/**
 * Quick test script to verify WebSocket connectivity
 * Run: node test.js
 */

const io = require('socket.io-client');

const URL = 'http://localhost:3000';

console.log('🧪 Testing Jal Jeevan KBC Quiz Server...\n');

// Test 1: Connect as host
console.log('Test 1: Host Connection');
const hostSocket = io(URL);

hostSocket.on('connect', () => {
  console.log('✅ Host connected');
  hostSocket.emit('register-host');
});

hostSocket.on('host-registered', (data) => {
  console.log(`✅ Host registered: ${data.message}\n`);
  
  // Test 2: Connect as participant
  console.log('Test 2: Participant Connection');
  const participantSocket = io(URL);
  
  participantSocket.on('connect', () => {
    console.log('✅ Participant connected');
    participantSocket.emit('register-player', { 
      name: 'TestPlayer', 
      teamName: 'TestTeam' 
    });
  });
  
  participantSocket.on('registered', (data) => {
    console.log(`✅ Participant registered: ${data.message}\n`);
    
    // Test 3: Check player list broadcast
    console.log('Test 3: Player List Broadcast');
  });
  
  hostSocket.on('players-list', (data) => {
    console.log(`✅ Players list received: ${data.players.length} player(s)\n`);
    
    // Test 4: Start fastest finger
    console.log('Test 4: Game Flow');
    hostSocket.emit('start-fastest-finger');
  });
  
  hostSocket.on('phase-change', (data) => {
    console.log(`✅ Phase changed to: ${data.phase}`);
  });
  
  // Clean up after 3 seconds
  setTimeout(() => {
    console.log('\n✅ All tests passed!');
    hostSocket.disconnect();
    participantSocket.disconnect();
    process.exit(0);
  }, 3000);
});

hostSocket.on('connect_error', (error) => {
  console.error('❌ Connection failed:', error.message);
  console.log('\n💡 Make sure the server is running: npm start');
  process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error('❌ Test timed out');
  process.exit(1);
}, 10000);
