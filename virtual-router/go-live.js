// File ini dipanggil ketika user klik "Go Live"
const { main } = require('./virtual-router');

console.log('🎯 Starting Secure Live Server...');
console.log('💡 This is a temporary session - will auto-clean when VS Code closes');

main().catch(error => {
    console.error('Failed to start virtual router:', error);
    process.exit(1);
});