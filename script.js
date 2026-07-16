const ADMIN_USER = "Ghoostcx";
const ADMIN_PASS = "Ghoostcx55";
const socket = io("http://localhost:3000");

// 1 SAATLİK OTOMATİK OTURUM KAPANMA MANTIĞI (Inactivity Timeout)
const ONE_HOUR = 60 * 60 * 1000;

function checkSession() {
    const loginTime = localStorage.getItem("loginTime");
    const lastActivity = localStorage.getItem("lastActivity");
    const now = Date.now();

    if (loginTime && lastActivity) {
        // Admin 1 saat boyunca hiçbir işlem yapmadıysa
        if (now - parseInt(lastActivity) > ONE_HOUR) {
            logout();
            alert("1 saat boyunca işlem yapılmadığı için oturumunuz kapatıldı.");
            return false;
        } else {
            showDashboard();
            updateActivity();
            return true;
        }
    }
    return false;
}

function updateActivity() {
    localStorage.setItem("lastActivity", Date.now().toString());
}

// Kullanıcı hareket ettikçe aktivite süresini yenile
window.addEventListener("click", updateActivity);
window.addEventListener("keypress", updateActivity);

function login() {
    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;

    if (u === ADMIN_USER && p === ADMIN_PASS) {
        const now = Date.now().toString();
        localStorage.setItem("loginTime", now);
        localStorage.setItem("lastActivity", now);
        showDashboard();
    } else {
        document.getElementById("login-error").style.display = "block";
    }
}

function logout() {
    localStorage.removeItem("loginTime");
    localStorage.removeItem("lastActivity");
    document.getElementById("login-screen").style.display = "block";
    document.getElementById("dashboard").style.display = "none";
}

function showDashboard() {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
}

// Sayfa yüklendiğinde oturumu kontrol et
checkSession();

socket.on('console-log', (data) => {
    appendLog(data.time, data.type, data.message);
});

socket.on('bot-list-update', (botList) => {
    const select = document.getElementById("activeBotSelect");
    document.getElementById("bot-count").innerText = botList.length;
    
    select.innerHTML = '<option value="ALL">-- TÜM BOTLAR (TOPLU) --</option>';
    botList.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.innerText = name;
        select.appendChild(option);
    });
});

socket.on('db-bots-update', (dbBots) => {
    const box = document.getElementById("db-bots-list");
    box.innerHTML = "";
    
    dbBots.forEach(bot => {
        const div = document.createElement("div");
        div.className = "db-item";
        div.innerHTML = `
            <span><b>${bot.username}</b> (${bot.host})</span>
            <button class="btn-small btn-danger" onclick="deleteDbBot('${bot.username}')">Sil</button>
        `;
        box.appendChild(div);
    });
});

function saveAndConnectBot() {
    const host = document.getElementById("serverIp").value;
    const port = document.getElementById("serverPort").value;
    const username = document.getElementById("botName").value;
    const autoCommand = document.getElementById("autoCommand").value;
    const autoReconnect = document.getElementById("autoReconnectCheck").checked;

    if (host && username) {
        socket.emit('save-and-connect-bot', { host, port, username, autoReconnect, autoCommand });
        document.getElementById("botName").value = "";
    }
}

function deleteDbBot(username) {
    socket.emit('delete-db-bot', { username });
}

function connectAllDbBots() {
    socket.emit('connect-all-db-bots');
}

function disconnectBot() {
    const username = document.getElementById("activeBotSelect").value;
    if (username !== "ALL") {
        socket.emit('disconnect-bot', { username });
    }
}

function sendChatMessage() {
    const input = document.getElementById("chatInput");
    const username = document.getElementById("activeBotSelect").value;
    
    if (input.value.trim() !== "") {
        socket.emit('send-chat', { username, message: input.value });
        input.value = "";
    }
}

function startMultiSpam() {
    const username = document.getElementById("activeBotSelect").value;
    const rawText = document.getElementById("spamMessages").value;
    const interval = document.getElementById("interval").value;

    if (username === "ALL") {
        alert("Spam için sol listeden bir bot seçin!");
        return;
    }

    const messages = rawText.split('\n').filter(msg => msg.trim() !== "");
    if (messages.length > 0 && interval) {
        socket.emit('start-multi-spam', { username, messages, interval: parseInt(interval) });
    }
}

function stopSpam() {
    const username = document.getElementById("activeBotSelect").value;
    socket.emit('stop-spam', { username });
}

function handleKeyPress(e) { if (e.key === 'Enter') sendChatMessage(); }
function clearConsole() { document.getElementById("console-output").innerHTML = ""; }

function appendLog(time, type, message) {
    const box = document.getElementById("console-output");
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    line.innerHTML = `<span class="log-time">[${time}]</span> ${escapeHtml(message)}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}