const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let loader;
try {
    loader = require('prismarine-chat');
} catch (e) {
    console.log("prismarine-chat yuklenmedi, varsayilan metin modu aktif.");
}

const app = express();
app.use(cors());
app.use(express.json());

// Tarayıcıdan Render linkine girildiğinde görünen durum sayfası
app.get('/', (req, res) => {
    res.send('<h1>👻 Ghoostcx Bot Backend Aktif ve Çalışıyor!</h1>');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- VERİTABANI KURULUMU (SQLite) ---
const db = new sqlite3.Database(path.join(__dirname, 'bots.db'), (err) => {
    if (err) console.error('Veritabani baglanti hatasi:', err.message);
    else console.log('SQLite Veritabani Baglantisi Basarili.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS saved_bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 25565,
        username TEXT UNIQUE NOT NULL,
        auto_reconnect INTEGER DEFAULT 1,
        auto_command TEXT DEFAULT '/towny'
    )`);
});

const bots = new Map();
const botConfigs = new Map();
const reconnectTimers = new Map();
const spamIntervals = new Map();

function logToConsole(type, message, botName = 'SYSTEM') {
    const time = new Date().toLocaleTimeString('tr-TR');
    const logData = { time, type, message: `[${botName}] ${message}` };
    console.log(`[${time}] [${type.toUpperCase()}] [${botName}] ${message}`);
    io.emit('console-log', logData);
}

function parseKickReason(reason, version = '1.20.4') {
    if (!reason) return "Sunucu aktarimi yapildi veya baglanti sonlandi.";
    if (typeof reason === 'string') {
        try { reason = JSON.parse(reason); } catch (e) { return reason; }
    }
    if (loader) {
        try {
            const Registry = loader(version);
            const chatMessage = new Registry(reason);
            const str = chatMessage.toString();
            if (str && str.trim()) return str;
        } catch (e) {}
    }
    if (reason && reason.value && reason.value.text) {
        return reason.value.text.value || JSON.stringify(reason);
    }
    const jsonStr = JSON.stringify(reason);
    return jsonStr !== "{}" ? jsonStr : "Sunucu aktarimi / Baglanti kesildi.";
}

function createBot(host, username, port = 25565, autoCommand = '/towny') {
    if (bots.has(username)) {
        logToConsole('warn', 'Bu isimde aktif bir bot zaten var!', username);
        return;
    }

    if (reconnectTimers.has(username)) {
        clearTimeout(reconnectTimers.get(username));
        reconnectTimers.delete(username);
    }

    logToConsole('system', `${host}:${port} sunucusuna baglaniliyor...`, username);

    const bot = mineflayer.createBot({
        host: host,
        port: parseInt(port),
        username: username,
        version: '1.20.4', // Melonya 1.20.4 - 1.21.8 zorunluluğu için sabitlendi
        checkTimeoutInterval: 90 * 1000,
        hideErrors: true,
        brand: 'vanilla'
    });

    // Kaynak Paketi Onayı
    bot._client.on('resource_pack_send', () => {
        logToConsole('system', 'Sunucu kaynak paketi istedi. Otomatik onaylaniyor...', username);
        bot._client.write('resource_pack_receive', { result: 3 }); // Kabul Edildi
        setTimeout(() => {
            if (bot._client) bot._client.write('resource_pack_receive', { result: 0 }); // Yüklendi
        }, 600);
    });

    // Velocity Proxy Paketlerini İhmal Etme / Dinleme
    bot._client.on('packet', (data, meta) => {
        if (meta.name === 'kick_disconnect' || meta.name === 'disconnect') {
            try {
                const parsed = parseKickReason(data.reason || data.data, bot.version);
                logToConsole('warn', `Aktarma Mesaji: ${parsed}`, username);
            } catch (e) {}
        }
    });

    bot.on('spawn', () => {
        logToConsole('success', 'Sunucuya basariyla giris yapildi!', username);
        bots.set(username, bot);
        updateBotList();
        startAntiAFK(bot);

        // KESİN ÇÖZÜM: /towny KOMUTUNU GECİKMELİ GÖNDERME
        if (autoCommand && autoCommand.trim() !== '') {
            logToConsole('system', `3 saniye icinde otomatik komut atilacak: ${autoCommand}`, username);
            setTimeout(() => {
                if (bots.has(username)) {
                    bot.chat(autoCommand);
                    logToConsole('sent', `[OTOMATİK KOMUT ATILDI]: ${autoCommand}`, username);
                }
            }, 3000);
        }
    });

    bot.on('chat', (sender, message) => {
        if (sender === bot.username) return;
        logToConsole('chat', `<${sender}> ${message}`, username);
    });

    bot.on('messagestr', (message) => {
        if (message.trim()) logToConsole('server', message, username);
    });

    bot.on('kicked', (reason) => {
        const cleanReason = parseKickReason(reason, bot.version);
        logToConsole('error', `Sunucudan atildi: ${cleanReason}`, username);
    });

    bot.on('end', () => {
        logToConsole('warn', 'Baglanti kesildi.', username);
        stopAntiAFK(username);
        stopSpam(username);
        bots.delete(username);
        updateBotList();

        const config = botConfigs.get(username);
        if (config && config.autoReconnect) {
            logToConsole('system', `5 saniye icinde otomatik yeniden baglaniliyor...`, username);
            const timer = setTimeout(() => {
                if (botConfigs.has(username) && botConfigs.get(username).autoReconnect) {
                    createBot(config.host, config.username, config.port, config.autoCommand);
                }
            }, 5000);
            reconnectTimers.set(username, timer);
        }
    });

    bot.on('error', (err) => {
        logToConsole('error', `Hata: ${err.message}`, username);
    });
}

function updateBotList() {
    io.emit('bot-list-update', Array.from(bots.keys()));
}

function sendDbBotsList(socket) {
    db.all(`SELECT * FROM saved_bots`, [], (err, rows) => {
        if (!err) socket.emit('db-bots-update', rows);
    });
}

function startAntiAFK(bot) {
    bot.antiAfkTimer = setInterval(() => {
        if (!bot || !bot.entity) return;
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 300);
        bot.look(Math.random() * Math.PI * 2, 0, false);
    }, 15000);
}

function stopAntiAFK(username) {
    const bot = bots.get(username);
    if (bot && bot.antiAfkTimer) clearInterval(bot.antiAfkTimer);
}

function stopSpam(username) {
    if (spamIntervals.has(username)) {
        clearInterval(spamIntervals.get(username));
        spamIntervals.delete(username);
    }
}

// Socket.IO
io.on('connection', (socket) => {
    updateBotList();
    sendDbBotsList(socket);

    // Bot Kaydet ve Bağla
    socket.on('save-and-connect-bot', (data) => {
        const { host, port, username, autoReconnect, autoCommand } = data;

        db.run(
            `INSERT OR REPLACE INTO saved_bots (host, port, username, auto_reconnect, auto_command) VALUES (?, ?, ?, ?, ?)`,
            [host, port || 25565, username, autoReconnect ? 1 : 0, autoCommand || '/towny'],
            function (err) {
                if (err) console.error("DB Kayit hatasi:", err.message);
                sendDbBotsList(io);
            }
        );

        botConfigs.set(username, {
            host,
            username,
            port: port || 25565,
            autoReconnect: autoReconnect !== undefined ? autoReconnect : true,
            autoCommand: autoCommand || '/towny'
        });

        createBot(host, username, port, autoCommand);
    });

    // Kayıtlı Botu Veritabanından Sil
    socket.on('delete-db-bot', (data) => {
        db.run(`DELETE FROM saved_bots WHERE username = ?`, [data.username], function(err) {
            if(!err) sendDbBotsList(io);
        });
    });

    // Kayıtlı Tüm Botları Bağla
    socket.on('connect-all-db-bots', () => {
        db.all(`SELECT * FROM saved_bots`, [], (err, rows) => {
            if (!err) {
                rows.forEach(row => {
                    botConfigs.set(row.username, {
                        host: row.host,
                        username: row.username,
                        port: row.port,
                        autoReconnect: row.auto_reconnect === 1,
                        autoCommand: row.auto_command
                    });
                    createBot(row.host, row.username, row.port, row.auto_command);
                });
            }
        });
    });

    socket.on('disconnect-bot', (data) => {
        const { username } = data;
        if (botConfigs.has(username)) botConfigs.get(username).autoReconnect = false;
        if (reconnectTimers.has(username)) {
            clearTimeout(reconnectTimers.get(username));
            reconnectTimers.delete(username);
        }
        const bot = bots.get(username);
        if (bot) bot.quit();
    });

    socket.on('send-chat', (data) => {
        const { username, message } = data;
        if (username === 'ALL') {
            bots.forEach((b, name) => {
                b.chat(message);
                logToConsole('sent', `[TOPLU MESAJ]: ${message}`, name);
            });
        } else {
            const bot = bots.get(username);
            if (bot) {
                bot.chat(message);
                logToConsole('sent', `[MESAJ]: ${message}`, username);
            }
        }
    });

    socket.on('start-multi-spam', (data) => {
        const { username, messages, interval } = data;
        stopSpam(username);

        let index = 0;
        const timer = setInterval(() => {
            const bot = bots.get(username);
            if (bot && messages.length > 0) {
                const msg = messages[index % messages.length];
                bot.chat(msg);
                logToConsole('sent', `[SPAM]: ${msg}`, username);
                index++;
            }
        }, interval * 1000);

        spamIntervals.set(username, timer);
        logToConsole('system', `Spam baslatildi (${interval}sn)`, username);
    });

    socket.on('stop-spam', (data) => {
        stopSpam(data.username);
        logToConsole('system', 'Spam durduruldu.', data.username);
    });
});

// Render.com otomatik Port ataması için dinamik port kullanımı
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`GHOOSTCX DATABASE BOT SERVER ONLINE: ${PORT}`);
});
