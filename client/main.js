const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { io } = require('socket.io-client');

let win;
let socket = null; // Declare socket globally

function createWindow() {
    win = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'assets/sifyaccessClient.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Setup Socket.io connection with IP address
function connectToServer(ipAddress) {
    socket = io(`http://${ipAddress}:3000`); // Use the IP address passed from the renderer

    // Handle server connection
    socket.on('connect', () => {
        console.log('Connected to server at IP:', ipAddress);
        win.webContents.send('server-status', 'Connected to server. Enter UUID to connect.'); // Send message to renderer
    });

    // Handle server disconnection
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        win.webContents.send('server-status', 'Disconnected from server');
    });

    // Handle screen sharing stopped by the server
    socket.on('screenShareStopped', (status) => {
        console.log('Screen sharing stopped by server.');
        win.webContents.send('server-status', status);
    });

    // Handle UUID matching
    socket.on('uuidMatch', (isMatch) => {
        if (isMatch) {
            console.log('UUID matched! Connected to server.');
            win.webContents.send('uuid-status', 'UUID matched! Connected to server.');
        } else {
            console.log('UUID mismatch. Please try again.');
            win.webContents.send('uuid-status', 'UUID mismatch. Please try again.');
        }
    });

    // Handle receiving screenshots
    socket.on('screenshot', (imgBase64) => {
        win.webContents.send('screenshot', imgBase64); // Send screenshot to renderer process
    });
}

// Listen for IP and UUID from renderer
ipcMain.on('connect-to-server', (event, { ipAddress, clientUUID }) => {
    if (!socket) {
        connectToServer(ipAddress); // Connect to server using the provided IP address
    }

    // Once connected, check UUID
    socket.emit('checkUUID', clientUUID);
});

// Handle client disconnect when app is closed
app.on('before-quit', () => {
    if (socket) {
        socket.emit('disconnectClient');
        socket.disconnect();
    }
});
