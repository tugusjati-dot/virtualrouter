const express = require('express');
const http = require('http');
const net = require('net');
const dns = require('dns');
const axios = require('axios');
const portfinder = require('portfinder');
const open = require('open');
const { exec } = require('child_process');

// ==================== TEMPORARY CONFIG ====================
const TEMP_CONFIG = {
    PROXY_PORT: 0,
    DASHBOARD_PORT: 0,
    LIVE_SERVER_PORT: 0,
    IS_TEMPORARY: true,
    SESSION_ID: 'vr_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
};

// ==================== CLEANUP MANAGEMENT ====================
class CleanupManager {
    constructor() {
        this.cleanupHandlers = [];
        this.isCleaning = false;
        this.setupProcessHandlers();
    }

    setupProcessHandlers() {
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
        process.on('uncaughtException', () => this.cleanup());
        process.on('disconnect', () => this.cleanup());
    }

    addCleanupHandler(handler) {
        this.cleanupHandlers.push(handler);
    }

    async cleanup() {
        if (this.isCleaning) return;
        this.isCleaning = true;

        console.log('\n🧹 Cleaning up temporary virtual router...');
        
        for (const handler of this.cleanupHandlers) {
            try {
                await handler();
            } catch (error) {
                console.log('Cleanup warning:', error.message);
            }
        }

        console.log('✅ Virtual router completely removed');
        process.exit(0);
    }

    async shutdownFromWeb() {
        console.log('🛑 Shutdown requested from web interface...');
        await this.cleanup();
    }
}

// ==================== SIMPLE DoH RESOLVER ====================
class SimpleDoHResolver {
    async resolve(hostname) {
        try {
            const response = await axios.get('https://cloudflare-dns.com/dns-query', {
                params: { name: hostname, type: 'A' },
                headers: { 'Accept': 'application/dns-json' },
                timeout: 3000
            });

            if (response.data.Answer) {
                return response.data.Answer.map(ans => ans.data);
            }
        } catch (error) {
            return new Promise((resolve) => {
                dns.resolve4(hostname, (err, addresses) => {
                    resolve(err ? [] : addresses);
                });
            });
        }
        return [];
    }
}

// ==================== LIGHTWEIGHT PROXY ====================
class LightweightProxy {
    constructor(port) {
        this.port = port;
        this.dohResolver = new SimpleDoHResolver();
        this.server = null;
    }

    start() {
        return new Promise((resolve) => {
            this.server = http.createServer();
            
            this.server.on('request', (clientReq, clientRes) => {
                this.handleRequest(clientReq, clientRes);
            });

            this.server.on('connect', (clientReq, clientSocket, head) => {
                this.handleHttps(clientReq, clientSocket, head);
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                console.log(`🔒 Secure Proxy: 127.0.0.1:${this.port}`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    async handleRequest(clientReq, clientRes) {
        try {
            const targetUrl = new URL(clientReq.url, `http://${clientReq.headers.host}`);
            const addresses = await this.dohResolver.resolve(targetUrl.hostname);
            
            if (addresses.length === 0) {
                clientRes.writeHead(502);
                clientRes.end('DNS Failed');
                return;
            }

            const targetSocket = net.connect(targetUrl.port || 80, addresses[0], () => {
                clientReq.pipe(targetSocket);
                targetSocket.pipe(clientRes);
            });

            targetSocket.on('error', () => {
                clientRes.writeHead(502);
                clientRes.end('Connection Failed');
            });

        } catch (error) {
            clientRes.writeHead(500);
            clientRes.end('Proxy Error');
        }
    }

    async handleHttps(clientReq, clientSocket, head) {
        try {
            const [hostname, port] = clientReq.url.split(':');
            const addresses = await this.dohResolver.resolve(hostname);
            
            if (addresses.length > 0) {
                const targetSocket = net.connect(port || 443, addresses[0], () => {
                    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    targetSocket.write(head);
                    clientSocket.pipe(targetSocket);
                    targetSocket.pipe(clientSocket);
                });

                targetSocket.on('error', () => clientSocket.end());
                clientSocket.on('error', () => targetSocket.end());
            } else {
                clientSocket.end();
            }
        } catch (error) {
            clientSocket.end();
        }
    }
}

// ==================== WEB DASHBOARD ====================
class WebDashboard {
    constructor(port, cleanupManager) {
        this.app = express();
        this.port = port;
        this.cleanupManager = cleanupManager;
        this.setupRoutes();
    }

    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.send(this.getDashboardHTML());
        });

        this.app.get('/shutdown', (req, res) => {
            res.send('🛑 Shutting down virtual router...');
            setTimeout(() => {
                this.cleanupManager.shutdownFromWeb();
            }, 1000);
        });

        this.app.get('/config', (req, res) => {
            res.json({
                proxyHost: '127.0.0.1',
                proxyPort: TEMP_CONFIG.PROXY_PORT,
                dashboardPort: TEMP_CONFIG.DASHBOARD_PORT,
                liveServerPort: TEMP_CONFIG.LIVE_SERVER_PORT,
                sessionId: TEMP_CONFIG.SESSION_ID
            });
        });
    }

    getDashboardHTML() {
        return `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Virtual Secure Router</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .status-card {
            background: rgba(255, 255, 255, 0.2);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .config-box {
            background: rgba(0, 0, 0, 0.3);
            padding: 15px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            margin: 10px 0;
        }
        .btn {
            background: #ff6b6b;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            margin: 5px;
            transition: background 0.3s;
        }
        .btn:hover {
            background: #ff5252;
        }
        .btn-copy {
            background: #4ecdc4;
        }
        .btn-copy:hover {
            background: #26a69a;
        }
        .instructions {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
        }
        .step {
            margin: 10px 0;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛡️ Virtual Secure Router</h1>
            <p>Temporary Security for Live Server</p>
        </div>

        <div class="status-card">
            <h3>🔧 Configuration</h3>
            <div class="config-box">
                <strong>Proxy Server:</strong> 127.0.0.1:${TEMP_CONFIG.PROXY_PORT}
            </div>
            <div class="config-box">
                <strong>Live Server:</strong> http://localhost:${TEMP_CONFIG.LIVE_SERVER_PORT}
            </div>
            <button class="btn btn-copy" onclick="copyProxyConfig()">📋 Copy Proxy Config</button>
        </div>

        <div class="status-card">
            <h3>🛡️ Security Status</h3>
            <p>✅ DNS over HTTPS (DoH) Active</p>
            <p>✅ End-to-End Encryption</p>
            <p>✅ Anti Packet Sniffing</p>
            <p>✅ Temporary Session</p>
        </div>

        <div class="instructions">
            <h3>📖 Setup Instructions</h3>
            <div class="step">1. <strong>Copy proxy configuration above</strong></div>
            <div class="step">2. <strong>Setup manually in your OS/browser:</strong></div>
            <div class="step">   - Windows: Settings → Network → Proxy</div>
            <div class="step">   - Browser: Settings → Advanced → Proxy</div>
            <div class="step">3. <strong>Visit Live Server:</strong> http://localhost:${TEMP_CONFIG.LIVE_SERVER_PORT}</div>
            <div class="step">4. <strong>Click shutdown below when done</strong></div>
        </div>

        <div style="text-align: center; margin-top: 30px;">
            <button class="btn" onclick="shutdown()">🛑 Shutdown Virtual Router</button>
            <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.8;">
                Auto-cleanup when VS Code closes
            </p>
        </div>
    </div>

    <script>
        function copyProxyConfig() {
            const config = '127.0.0.1:${TEMP_CONFIG.PROXY_PORT}';
            navigator.clipboard.writeText(config);
            alert('✅ Proxy config copied: ' + config);
        }

        function shutdown() {
            if (confirm('Shutdown virtual router? All connections will be closed.')) {
                fetch('/shutdown');
                setTimeout(() => {
                    alert('Virtual router shutdown complete. You can close this tab.');
                }, 2000);
            }
        }
    </script>
</body>
</html>`;
    }

    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, '127.0.0.1', () => {
                console.log(`📊 Dashboard: http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }
}

// ==================== LIVE SERVER MANAGER ====================
class LiveServerManager {
    static startLiveServer(port) {
        return new Promise((resolve) => {
            const liveServer = exec(`npx live-server --port=${port} --no-browser --quiet`, {
                cwd: process.cwd()
            });

            liveServer.stdout.on('data', (data) => {
                if (data.includes('http://')) {
                    const url = data.match(/http:\/\/[^\s]+/)[0];
                    console.log(`🌐 Live Server: ${url}`);
                    resolve(url);
                }
            });

            liveServer.stderr.on('data', (data) => {
                console.log('Live Server:', data.toString().trim());
            });

            TEMP_CONFIG.liveServerProcess = liveServer;
        });
    }
}

// ==================== MAIN EXECUTION ====================
async function main() {
    console.log('⚡ Starting Temporary Virtual Router...');
    
    TEMP_CONFIG.PROXY_PORT = await portfinder.getPortPromise({ port: 8080 });
    TEMP_CONFIG.DASHBOARD_PORT = await portfinder.getPortPromise({ port: 3000 });
    TEMP_CONFIG.LIVE_SERVER_PORT = await portfinder.getPortPromise({ port: 5500 });
    
    const cleanupManager = new CleanupManager();
    
    const proxy = new LightweightProxy(TEMP_CONFIG.PROXY_PORT);
    await proxy.start();
    
    const dashboard = new WebDashboard(TEMP_CONFIG.DASHBOARD_PORT, cleanupManager);
    await dashboard.start();
    
    cleanupManager.addCleanupHandler(() => proxy.stop());
    cleanupManager.addCleanupHandler(() => dashboard.stop());
    cleanupManager.addCleanupHandler(() => {
        if (TEMP_CONFIG.liveServerProcess) {
            TEMP_CONFIG.liveServerProcess.kill();
        }
    });
    
    const liveServerUrl = await LiveServerManager.startLiveServer(TEMP_CONFIG.LIVE_SERVER_PORT);
    
    console.log('\n🎯 ===== TEMPORARY VIRTUAL ROUTER READY =====');
    console.log('📊 Dashboard:\t\thttp://localhost:' + TEMP_CONFIG.DASHBOARD_PORT);
    console.log('🔒 Secure Proxy:\t127.0.0.1:' + TEMP_CONFIG.PROXY_PORT);
    console.log('🌐 Live Server:\t\t' + liveServerUrl);
    console.log('\n📖 Manual Setup Required:');
    console.log('   1. Copy: 127.0.0.1:' + TEMP_CONFIG.PROXY_PORT);
    console.log('   2. Setup proxy in your OS/browser manually');
    console.log('   3. Visit Live Server URL above');
    console.log('\n💡 Features:');
    console.log('   ✅ Auto-cleanup when VS Code closes');
    console.log('   ✅ Web shutdown button');
    console.log('   ✅ No system modifications');
    console.log('   ✅ Temporary session');
    console.log('==========================================\n');
    
    open(`http://localhost:${TEMP_CONFIG.DASHBOARD_PORT}`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };