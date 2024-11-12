const { app, BrowserWindow, ipcMain, Menu, screen,clipboard,shell } = require('electron');
const fs = require('fs');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const screenshot = require('screenshot-desktop');
const robot = require('robotjs');
const os = require('os');

// Get the OS name
const osName = os.type(); // For example: 'Linux', 'Darwin' (for macOS), or 'Windows_NT'
const osPlatform = os.platform(); // More specific, e.g., 'linux', 'win32', 'darwin'

// Get user information
const userInfo = os.userInfo(); // Returns an object with user details

console.log(`Operating System: ${osName}`);
console.log(`User Info:`, userInfo.username);
const uploadsDir = path.join(app.getPath('userData'), 'uploads');

// Ensure the uploads directory exists
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

let mainWindow;
let socket = null;
let screenshotInterval = null;
const publicServerUrl = 'http://223.30.222.66:5036';
// const io = new Server(3001);
const io = new Server(3001, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 10 * 1024 * 1024 // 6 MB
});
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 500,
        icon: path.join(__dirname, 'assets/access.ico'),
        maximizable: false, // Disable the maximize button
        resizable: false,   // Disable window resizing
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    Menu.setApplicationMenu(null);
    mainWindow.loadFile('index.html');
    // Handle the IPC event to send OS info to the renderer
// Send OS name when the window is ready
ipcMain.handle('get-os-info', () => {
    let osName;
    switch (os.type()) {
      case 'Linux':
        osName = 'Linux';
        break;
      case 'Darwin':
        osName = 'macOS';
        break;
      case 'Windows_NT':
        osName = 'Windows';
        break;
      default:
        osName = 'Unknown OS';
    }
    return osName;
  });
}



app.whenReady().then(() => {
    createWindow();

    const publicSocket = require('socket.io-client')(publicServerUrl);

    // Connect to the public server
    publicSocket.on('connect', () => {
        console.log('Connected to public server');
        publicSocket.emit('registerServer');
        io.emit('registerServer');
    });

    // Handle socket connection errors
    publicSocket.on('connect_error', (error) => {
        console.error('Connection error with public server:');
        io.emit('connect_error_public');
    });

    // Handle disconnection event
    publicSocket.on('disconnect', (reason) => {
        console.error('Disconnected from public server:', reason);
        io.emit('disconnect_public');
    });

    // Get screen size of the target machine
    const primaryDisplay = screen.getPrimaryDisplay();
    const targetWidth = primaryDisplay.size.width;
    const targetHeight = primaryDisplay.size.height;

    // Log the resolution
    console.log(`Display Resolution: ${targetWidth} x ${targetHeight}`);

    // Listen for UUID requests from the local socket server
    io.on('connection', (clientSocket) => {
        console.log('A client connected to the local server');
        // publicSocket.emit('registerServer');
        io.emit('registerServer');

        clientSocket.on('requestUUID', () => {
            const genUUID = uuidv4();
            const generatedUUID = genUUID.slice(0, 5);
            console.log(`Generated UUID: ${generatedUUID}`);


            publicSocket.emit('registerUUID', { uuid: generatedUUID });
            
            // Handle the acknowledgment or response from the server
            publicSocket.on('uuidRegistered', (response) => {
                console.log('Response from public server:', response);
                // Notify the client that a new UUID has been generated
                clientSocket.emit('newUUID', generatedUUID);
            });

            // Handle errors if needed
            publicSocket.on('uuidRegistrationError', (error) => {
                console.error('Error from public server:', error);
            });
        });

        // Handle screenshot requests
        publicSocket.on('requestScreenshots', (data) => {
            const biosnumber = data.biosnumber;
            const serveruuid = data.uuid;

            console.log('Public server requested screenshots, BIOS number:', biosnumber, ' StoredUUID:',serveruuid);
            io.emit('clientConnected', { biosnumber: biosnumber });
            startScreenshotSharing(publicSocket,serveruuid);
        });

        // Receive new files from the main process
        // publicSocket.on('new-files-found', (fileInfo, enteredUUID) => {

        //     console.log(`File received: ${fileInfo.fileName} (UUID: ${enteredUUID})`);
        
        //     // Convert the ArrayBuffer back to a buffer to save the file
        //     const buffer = Buffer.from(new Uint8Array(fileInfo.fileData));
            
        //     let clientfolderPath;
        //     // Verify enteredUUID is defined and not empty
        //     if (enteredUUID) {
        //         clientfolderPath = path.join(uploadsDir, enteredUUID);
        
        //         // Check if the folder exists; if not, create it
        //         if (!fs.existsSync(clientfolderPath)) {
        //             fs.mkdirSync(clientfolderPath, { recursive: true });
        //         }
        //     } else {
        //         console.error("Error: enteredUUID is undefined or empty.");
        //         return; // Exit the function if enteredUUID is not valid
        //     }
        
        //     console.log('Folder path:', clientfolderPath);
        
        //     // Define the file path inside the UUID folder
        //     const filePath = path.join(clientfolderPath, fileInfo.fileName);
        
        //     // Save the file to the server inside the UUID folder
        //     fs.writeFile(filePath, buffer, (err) => {
        //         if (err) {
        //             console.error('Error saving file:', err);
        //             socket.emit('file-save-error', 'Error saving the file.');
        //         } else {
        //             console.log(`File "${fileInfo.fileName}" saved successfully at ${filePath}`);
        
        //             // Emit a file-update event to all connected clients
        //             io.emit('file-update', {
        //                 message: `"${fileInfo.fileName}" has been received. Click to open! ${clientfolderPath}`,
        //                 fileInfo: fileInfo, // Optionally include file info
        //                 folderPath: clientfolderPath,
        //             });
        //         }
        //     });
        // });
        const fileChunks = {}; // To store incoming chunks temporarily

 
        publicSocket.on('new-files-found', (fileInfo, enteredUUID) => {
            console.log(`Received chunk for file: ${fileInfo.fileName} (UUID: ${enteredUUID}), Chunk: ${fileInfo.chunkIndex + 1}/${fileInfo.totalChunks}`);
        
            // Verify enteredUUID is defined and not empty
            if (!enteredUUID) {
                console.error("Error: enteredUUID is undefined or empty.");
                return; // Exit the function if enteredUUID is not valid
            }
        
            // Create a unique identifier for the file
            const fileKey = `${enteredUUID}-${fileInfo.fileName}`;
            
            // Initialize the array to hold chunks if it's the first chunk
            if (!fileChunks[fileKey]) {
                fileChunks[fileKey] = {
                    chunks: new Array(fileInfo.totalChunks), // Array to hold chunks
                    fileName: fileInfo.fileName,
                    receivedChunks: 0
                };
            }
        
            // Store the incoming chunk
            fileChunks[fileKey].chunks[fileInfo.chunkIndex] = Buffer.from(new Uint8Array(fileInfo.fileData));
            fileChunks[fileKey].receivedChunks++;
        
            // Check if all chunks have been received
            if (fileChunks[fileKey].receivedChunks === fileInfo.totalChunks) {
                console.log(`All chunks received for file: ${fileInfo.fileName}. Saving to disk...`);
                
                // Combine all chunks and save the file
                const completeBuffer = Buffer.concat(fileChunks[fileKey].chunks);
                console.log(`Total buffer size for "${fileInfo.fileName}": ${completeBuffer.length} bytes`);
        
                // Define the folder path using the UUID
                const clientfolderPath = path.join(uploadsDir, enteredUUID);
        
                // Check if the folder exists; if not, create it
                if (!fs.existsSync(clientfolderPath)) {
                    fs.mkdirSync(clientfolderPath, { recursive: true });
                    console.log(`Created directory: ${clientfolderPath}`);
                }
        
                // Define the file path inside the UUID folder
                const filePath = path.join(clientfolderPath, fileInfo.fileName);
        
                // Save the complete file to the server inside the UUID folder
                fs.writeFile(filePath, completeBuffer, (err) => {
                    if (err) {
                        console.error('Error saving file:', err);
                        publicSocket.emit('file-save-error', 'Error saving the file.');
                    } else {
                        console.log(`File "${fileInfo.fileName}" saved successfully at ${filePath}`);
        
                        // Emit a file-update event to all connected clients
                        io.emit('file-update', {
                            message: `"${fileInfo.fileName}" has been received. Click to open! ${clientfolderPath}`,
                            fileInfo: fileInfo, // Optionally include file info
                            folderPath: clientfolderPath,
                        });
                    }
                });
        
                // Clean up the chunks data for this file
                delete fileChunks[fileKey];
            }
        });

        publicSocket.on('client-disconnected', (biosSerialNumber) => {
            console.log('Client (',biosSerialNumber,') Disconnected from Public server');
            console.log('Screenshot stopped to ',biosSerialNumber,' client');
            // stopScreenshotSharing(publicSocket);
            io.emit('clientDisconnected',biosSerialNumber);
            
        });


        // Function to scale coordinates based on source and target screen size
        function scaleCoordinates(x, y) {
    

            const scaledX =x;
            const scaledY = y;
            return { x: Math.round(scaledX), y: Math.round(scaledY) };
        }

        // Replace the mouse-move event handling
        publicSocket.on('mouse-move', (coordinates) => {
            const { x, y } = scaleCoordinates(coordinates.x, coordinates.y);
            // console.log('Mouse move to', { x, y });
            robot.moveMouse(x, y);
        });
        
        publicSocket.on('mouse-click', (coordinates) => {
            const { x, y } = scaleCoordinates(coordinates.x, coordinates.y);
            // console.log('Mouse click at', { x, y });
            robot.moveMouse(x, y);
            robot.mouseClick();
        });


        let controlPressed = false; // Track if the Control key is pressed
        let keyPressedRecently = false; // Debounce flag
        let shiftActive = false; // Track if Shift is currently pressed
        
        publicSocket.on('key-press', (key) => {
            if (keyPressedRecently) return;
            // keyPressedRecently = true;
        
            // setTimeout(() => {
            //     keyPressedRecently = false;
            // }, 200); // Adjust the delay if needed
        
            // console.log('Key press received:', key);
        
            // Handle Control key
            if (key === 'Control' || key === 'control') {
                controlPressed = true;
                // console.log('Control key pressed.');
                return;
            } else if (key === 'Shift' || key === 'shift') {
                // Ignore additional Shift presses
                if (shiftActive) return;
                shiftActive = true; // Set the flag to indicate Shift is pressed
                // console.log('Shift key pressed.');
                return; // Early exit to avoid further processing
            } else if (key === 'CapsLock') {
                // console.log('CapsLock pressed (no key tap sent).');
                return;
            } else if (key === 'Alt') {
                return;
            }
        
            // Handle Clipboard Operations
            if (controlPressed) {
                switch (key) {
                    case 'a':
                    case 'A':
                        // console.log('Sending Ctrl + A to select all...');
                        robot.keyToggle('control', 'down'); // Press Control
                        robot.keyTap('a'); // Tap 'A'
                        robot.keyToggle('control', 'up'); // Release Control
                        controlPressed = false; // Reset controlPressed after select all
                        return; // Exit after select all
                    case 'c':
                    case 'C':
                        // console.log('Sending Ctrl + C for copy...');
                        robot.keyToggle('control', 'down'); // Press Control
                        robot.keyTap('c'); // Tap 'C'
                        robot.keyToggle('control', 'up'); // Release Control

                        const copiedData = clipboard.readText();
                        // console.log('Copied Data:', copiedData); // Log copied data to console
                        io.emit('copiedData',copiedData);


                        return; // Exit after copy
                    case 'v':
                    case 'V':
                        // console.log('Sending Ctrl + V for paste...');
                        robot.keyToggle('control', 'down'); // Press Control
                        robot.keyTap('v'); // Tap 'V'
                        robot.keyToggle('control', 'up'); // Release Control
                        controlPressed = false; // Reset controlPressed after paste
                        return; // Exit after paste
                    case 'x':
                    case 'X':
                        // console.log('Sending Ctrl + X for cut...');
                        robot.keyToggle('control', 'down'); // Press Control
                        robot.keyTap('x'); // Tap 'X'
                        robot.keyToggle('control', 'up'); // Release Control
                        controlPressed = false; // Reset controlPressed after cut
                        return; // Exit after cut
                     // Add Undo (Ctrl + Z)
                case 'z':
                case 'Z':
                    // console.log('Sending Ctrl + Z for undo...');
                    robot.keyToggle('control', 'down'); // Press Control
                    robot.keyTap('z'); // Tap 'Z'
                    robot.keyToggle('control', 'up'); // Release Control
                    controlPressed = false;
                    return; // Exit after undo
                
                // Add Redo (Ctrl + Y)
                case 'y':
                case 'Y':
                    // console.log('Sending Ctrl + Y for redo...');
                    robot.keyToggle('control', 'down'); // Press Control
                    robot.keyTap('y'); // Tap 'Y'
                    robot.keyToggle('control', 'up'); // Release Control
                    controlPressed = false;
                    return; // Exit after redo
                    
                }
            }
        


    // Handle Arrow Keys
    switch (key) {
        case 'ArrowUp':
            // console.log('Sending Arrow Up key...');
            robot.keyTap('up');
            return;
        case 'ArrowDown':
            // console.log('Sending Arrow Down key...');
            robot.keyTap('down');
            return;
        case 'ArrowLeft':
            // console.log('Sending Arrow Left key...');
            robot.keyTap('left');
            return;
        case 'ArrowRight':
            // console.log('Sending Arrow Right key...');
            robot.keyTap('right');
            return;
            
        case 'Tab':  // Handle the Tab key
        robot.keyTap('tab');
        return;
    }



            // Map for Shift key combinations
            const shiftKeyMap = {
                ':': ';',
                '"': '\'',
                '<': ',',
                '>': '.',
                '?': '/',
                '_': '-',
                '+': '=',
                '{': '[',
                '}': ']',
                '|': '\\',
                '~': '`',
                '!': '1',
                '@': '2',
                '#': '3',
                '$': '4',
                '%': '5',
                '^': '6',
                '&': '7',
                '*': '8',
                '(': '9',
                ')': '0'
            };
        
            // Handle specific symbols without Shift
            const specialKeys = {
                '-': '-',
                '=': '=',
                '[': '[',
                ']': ']',
                ';': ';',
                '\'': '\'',
                ',': ',',
                '.': '.',
                '/': '/',
                '\\': '\\',  // Backslash
                '`': '`'     // Backtick
            };
        
            // Handle key presses
            if (specialKeys[key]) {
                // console.log(`Sending ${key} key...`);
                robot.keyTap(specialKeys[key]);
            } else if (shiftKeyMap[key]) {
                // console.log(`Sending Shift + ${shiftKeyMap[key]} for "${key}"`);
                try {
                    robot.keyToggle('shift', 'down');  // Press Shift
                    robot.keyTap(shiftKeyMap[key]);    // Tap the corresponding key
                    robot.keyToggle('shift', 'up');    // Release Shift
                    shiftActive = false; // Reset Shift status after key press
                } catch (error) {
                    console.error('Error processing Shift key combination:', error);
                }
            } else if (/^\d$/.test(key)) {
                // Handle numbers 0-9
                // console.log(`Sending number key: ${key}`);
                robot.keyTap(key);
            } else {
                // Handle other keys and letters
                switch (key) {
                    case 'Backspace':
                        // console.log('Sending backspace key...');
                        robot.keyTap('backspace');
                        break;
                    case 'Delete':
                        // console.log('Sending delete key...');
                        robot.keyTap('delete');
                        break;
                    case 'Enter':
                        // console.log('Sending Enter key...');
                        robot.keyTap('enter');
                        break;
                    case 'Tab':  // This should capture Tab
                        robot.keyTap('tab');
                        break;
                    default:
                        if (key.length === 1 && key === key.toUpperCase()) {
                            // If key is a capital letter, use shift
                            // console.log(`Sending Shift + ${key.toLowerCase()} for "${key}"`);
                            try {
                                robot.keyToggle('shift', 'down'); // Press Shift
                                robot.keyTap(key.toLowerCase()); // Tap the lowercase version
                                robot.keyToggle('shift', 'up'); // Release Shift
                            } catch (error) {
                                console.error('Error processing Shift key for capital letter:', error);
                            }
                        } else {
                            // For any other key, just tap it directly
                            // console.log(`Sending key "${key}"`);
                            robot.keyTap(key);
                        }
                        break;
                }
            }
        
            // Reset Control and Shift statuses when other keys are pressed
            if (controlPressed && key !== 'Control') {
                controlPressed = false; // Reset controlPressed only if a non-Control key is pressed
            }
        
            if (shiftActive && key !== 'Shift' && key !== 'shift') {
                shiftActive = false; // Reset if any key other than Shift is pressed
            }
        });
        

        publicSocket.on('sstopSharing', () => {
            console.log('Stop Screenshot');
            console.log('SS Stop Screenshot');
            stopScreenshotSharing(publicSocket);
             
        });
        
        clientSocket.on('sendCopiedData',(copiedData,sanitizeuuid) => {
            publicSocket.emit('copiedData',copiedData,sanitizeuuid);

            console.log('Copied Data:', copiedData); // Log copied data to console

        });

        // Stop sharing logic on local socket
        clientSocket.on('stopSharing', (uuid) => { 
            const folderPath = path.join(uploadsDir, String(uuid)); // Convert uuid to string if necessary
        
            // Check if the folder exists and delete it
            if (fs.existsSync(folderPath)) {
                fs.rm(folderPath, { recursive: true, force: true }, (err) => {
                    if (err) {
                        console.error(`Error deleting folder ${folderPath}:`, err);
                    } else {
                        console.log(`Successfully deleted folder: ${folderPath}`);
                    }
                });
            } else {
                console.log(`No folder found for UUID: ${uuid}`);
            }
        
            console.log('Initiated stop share');
            stopScreenshotSharing(publicSocket, uuid);
        
            // Emit events to register the server after stopping screen sharing, with a slight delay
            setTimeout(() => {
                publicSocket.emit('registerServer');
                io.emit('registerServer');
            }, 2000); // Adjust the delay as needed
        });

        


        clientSocket.on('share-file-client', (data) => {
            const { sanitizeuuid, biosnumber, fileName, fileData } = data;
    
            // You can now handle the file, for example, save it to the server or send it to connected clients
            console.log(`Received file: ${fileName} from BIOS: ${biosnumber} with UUID: ${sanitizeuuid}`);
            // Optionally, broadcast the file to other clients
            publicSocket.emit('forward-file-data', { sanitizeuuid, biosnumber, fileName, fileData });
        });
    });
});

// function startScreenshotSharing(publicSocket, serveruuid) {
//     let screenshotCount = 0; // Initialize a counter variable
//     const screenshotInterval = setInterval(() => {
//         screenshot().then((img) => {
//             publicSocket.emit('screenshot', { imgBase64: img.toString('base64'), serveruuid });
//             screenshotCount++; // Increment the counter
            
//             if (screenshotCount % 10 === 0) {
//                 console.log(`Shared ${screenshotCount} screenshots for UUID: ${serveruuid}`);
//             }
//         }).catch((err) => {
//             console.error('Screenshot error: ', err);
//             clearInterval(screenshotInterval); // Stop on error if needed
//         });
//     }, 500);
// }

function startScreenshotSharing(publicSocket, serveruuid) {
    let screenshotCount = 0; // Initialize a counter variable

    // Ensure no existing screenshot sharing is running
    if (screenshotInterval) {
        console.log('Screenshot sharing is already active.');
        return; // Prevent starting a new interval
    }

    // Ensure publicSocket and serveruuid are valid
    if (!publicSocket || !serveruuid) {
        console.error('Invalid publicSocket or serverUUID. Cannot start screenshot sharing.');
        return;
    }

    // Start the interval for screenshot sharing
    screenshotInterval = setInterval(() => {
        screenshot().then((img) => {
            publicSocket.emit('screenshot', { imgBase64: img.toString('base64'), serveruuid });
            screenshotCount++; // Increment the counter

            // Log every 10 screenshots
            // if (screenshotCount % 10 === 0) {
            //     console.log(`Shared ${screenshotCount} screenshots for UUID: ${serveruuid}`);
            // }
        }).catch((err) => {
            console.error('Screenshot error: ', err);
            clearInterval(screenshotInterval); // Stop on error if needed
            screenshotInterval = null; // Reset interval
        });
    }, 500); // Take screenshot every 500 ms
}
// function stopScreenshotSharing(publicSocket,uuid) {
//     if (screenshotInterval) {
//         clearInterval(screenshotInterval);
//         screenshotInterval = null;
//         publicSocket.emit('stopSharing',uuid);

//         console.log(`Screenshot sharing stopped for ${uuid}.`);
//     }
// }

function stopScreenshotSharing(publicSocket, uuid) {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;

        // Check if publicSocket and uuid are valid before emitting
        if (publicSocket && uuid) {
            publicSocket.emit('stopSharing', uuid);
            console.log(`Screenshot sharing stopped for ${uuid}.`);
        } else {
            console.error('Unable to stop sharing: Invalid publicSocket or UUID.');
        }
    } else {
        console.log('Screenshot sharing is not active.');
    }
}

// Handle IPC for sending server IP address
ipcMain.on('getServerIP', (event) => {
    const serverIP = '223.30.222.66'; // Example IP
    event.reply('server-ip', serverIP);
});

 // Listen for 'open-folder' event with the folder path
ipcMain.on('open-folder', (event, folderPath) => {
    if (folderPath) {
        console.log(`open folder path : ${folderPath}`);
        shell.openPath(folderPath);
        folderPath='';
    } else {
        console.log("No valid folder path provided.");
    }
});



// Handle app exit
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle client disconnect when app is closed
app.on('before-quit', () => {
    if (socket) {
        socket.emit('disconnectServer');
        socket.disconnect();
    }
});
