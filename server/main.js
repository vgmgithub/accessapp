const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const screenshot = require('screenshot-desktop');
const os = require('os'); // Required to get IP address

let win;
let generatedUUID = '';
let screenshotInterval = null; // To track the screenshot interval

// Function to get local IP address
function getIPAddress() {
    const interfaces = os.networkInterfaces();
    for (let iface in interfaces) {
        for (let alias of interfaces[iface]) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'Unable to determine IP address';
}

function createWindow() {
    win = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'assets/sifyaccess.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    win.loadFile('index.html');

    // Send the IP address to the renderer process after the window is ready
    const ipAddress = getIPAddress();
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('server-ip', ipAddress); // Send IP address
    });
}

// Ensure `app` is defined before calling methods on it
app.whenReady().then(() => {
    createWindow();

    // Setup Socket.io server
    const io = new Server(3000);

    io.on('connection', (socket) => {
        console.log('Client connected to server but awaiting UUID match.');

        // Generate UUID when screen sharing is initiated
        socket.on('requestUUID', () => {
            generatedUUID = uuidv4();
            console.log(`Generated UUID: ${generatedUUID}`);
            socket.emit('newUUID', generatedUUID);  // Send the UUID to the client
        });

        // Check UUID provided by the client
        socket.on('checkUUID', (clientUUID) => {
            const isMatch = (clientUUID === generatedUUID);
            socket.emit('uuidMatch', isMatch);

            if (isMatch) {
                console.log('UUID matched, starting to send screenshots');
                io.emit('clientConnected');  // Notify the server's UI that the client is connected after UUID match

                // Send screenshots periodically
                screenshotInterval = setInterval(() => {
                    screenshot().then((img) => {
                        socket.emit('screenshot', img.toString('base64'));
                    }).catch((err) => {
                        console.error('Screenshot error: ', err);
                    });
                }, 100);
            } else {
                console.log('UUID mismatch');
            }
        });

        // Handle stop sharing event from the server-side "Stop Sharing" button
        socket.on('stopSharing', () => {
            if (screenshotInterval) {
                clearInterval(screenshotInterval);
                screenshotInterval = null;
                console.log('Screen sharing stopped by server.');

                // Emit event to client first
                socket.emit('screenShareStopped', 'Connection disconnected. Screen sharing stopped.');

                // Reset UUID
                generatedUUID = ''; // Clear the UUID

                // Now emit server disconnection event
                io.emit('serverDisconnected'); // Notify server's UI

                // Reload the window
                win.reload(); // Reloads the window
            }
        });

        // Handle client disconnecting unexpectedly
        socket.on('disconnect', () => {
            clearInterval(screenshotInterval);
            console.log('Client disconnected unexpectedly.');
            io.emit('clientDisconnected');  // Notify the server's UI that the client is disconnected
        });
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
