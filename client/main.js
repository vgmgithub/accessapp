const { app, BrowserWindow, Menu, ipcMain, clipboard,shell } = require('electron');
const path = require('path');
const { io } = require('socket.io-client');
const { exec } = require('child_process'); // Import child_process
const os = require('os'); // Import the os module
const fs = require('fs'); // Ensure this is imported
let win;
let socket = null; // Declare socket globally
const publicServerUrl = 'http://223.30.222.66:5036'; // Your public server URL
let systemUuid = null;
let systemBios = null;

function createWindow() {
    win = new BrowserWindow({
        width: 800,
        height: 700,
        icon: path.join(__dirname, 'assets/accessClient.ico'),
        // resizable: false, // Prevent resizing
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    // Menu.setApplicationMenu(null);
    win.loadFile('index.html');
    

    // Emit the screen size to the public server
}

app.whenReady().then(() => {
    createWindow();

    console.log('Attempting to connect to public server...');
    socket = io(publicServerUrl);

    // Handle server connection
    socket.on('connect', async () => {
        console.log('Connected to public server');
        win.webContents.send('server-status', 'Connected to public server. Enter UUID to connect.');
        
         // Get screen size of the target machine
         const [targetWidth, targetHeight] = win.getSize(); // Correctly destructure the array returned by getSize()

         // Log the resolution
         console.log(`Display Resolution: ${targetWidth} x ${targetHeight}`);
        //  socket.emit('client-screen-size', { width: targetWidth, height: targetHeight });
        
         const biosSerialNumber = await getBiosSerialNumber();
         systemBios=biosSerialNumber;
         console.log(`3BIOS Serial Number: ${biosSerialNumber}`);
        // Register the client with the public server and send the BIOS serial number
        socket.emit('registerClient', { biosSerialNumber });
        win.webContents.send('client-disconnect-received',"1");
        

    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error with public server:');
        // win.webContents.send('connect_error_public');
        win.webContents.send('reconnect_attempt_public', 'Attempting to reconnect to public server...');
        

    });
 
    socket.on('reconnect_attempt', () => {
        console.log('Attempting to reconnect to public server...');
        win.webContents.send('reconnect_attempt_public', 'Attempting to reconnect to public server...');

        
    });

    socket.on('registration-failed', (reason) => {
        console.error('No Access to public server:', reason);
        win.webContents.send('no_access');

    });

    socket.on('copiedData', (copiedData) => {
        console.log('Copied Data from server is:', copiedData);
        clipboard.writeText(copiedData);
    });

    socket.on('disconnect', (reason) => {
        console.error('Disconnected from public server:', reason);
        
        // win.webContents.send('connect_error_public');

    });
    
    socket.on('file-saved', (message) => {
        console.log('rece msg ',message);
        win.webContents.send('file-saved',message.toString());

    });


    // IPC listener for 'file-share' event from index.html
    // ipcMain.on('file-share', (event, fileInfo,enteredUUID) => {
    //     console.log(`Received file "${fileInfo.fileName}" in the main process. Sending to public server.`);

    //     // Send the file data to the public server via Socket.io
    //     socket.emit('file-share', fileInfo,enteredUUID);

    //     console.log(`File "${fileInfo.fileName}" has been sent to the public server.`);
    // });


    // ipcMain.on('file-share', (event, fileInfo,enteredUUID) => {
    //     const { fileName, fileData, chunkIndex, totalChunks } = fileInfo;
    
    //     console.log(`Received chunk ${chunkIndex + 1}/${totalChunks} for file "${fileName}" in the main process.`);
    
    //     // Create the uploads directory if it doesn't exist
    //     const folderPath = path.join(__dirname, 'uploads', enteredUUID);
    //     if (!fs.existsSync(folderPath)) {
    //         fs.mkdirSync(folderPath, { recursive: true });
    //     }
    
    //     // Define the file path for the file to be saved
    //     const filePath = path.join(folderPath, fileName);
    
    //     // Append the chunk data to the file
    //     fs.writeFile(filePath, Buffer.from(new Uint8Array(fileData)), { flag: 'a' }, (err) => {
    //         if (err) {
    //             console.error('Error saving file chunk:', err);
    //             return;
    //         }
    
    //         console.log(`Chunk ${chunkIndex + 1} for "${fileName}" saved successfully.`);
    
    //         // After saving the chunk, emit the chunk to the public server
    //         socket.emit('file-share', { 
    //             fileName, 
    //             fileData, 
    //             chunkIndex, 
    //             totalChunks 
    //         }, enteredUUID);
    
    //         console.log(`Chunk ${chunkIndex + 1} of file "${fileName}" has been sent to the public server.`);
    
    //         // Optionally, you can check if this is the last chunk and perform any final actions
    //         if (chunkIndex + 1 === totalChunks) {
    //             console.log(`All chunks for "${fileName}" have been uploaded successfully.`);
    //             // You can send a message back to the renderer to indicate completion if needed
    //             event.reply('upload-complete', { fileName, enteredUUID });
    //         }
    //     });
    // });


    
ipcMain.on('file-share', (event, fileInfo, enteredUUID) => {
    const { fileName, fileData, chunkIndex, totalChunks } = fileInfo;
    console.log(`Received chunk ${chunkIndex + 1}/${totalChunks} for file "${fileName}" in the main process.`);

    // Use a directory within userData to store uploads (this path is writable in production)
    const folderPath = path.join(app.getPath('userData'), 'uploads', enteredUUID);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    // Define the file path for saving the file
    const filePath = path.join(folderPath, fileName);

    // Append the chunk data to the file
    fs.appendFile(filePath, Buffer.from(fileData), (err) => {
        if (err) {
            console.error('Error saving file chunk:', err);
            return;
        }

        console.log(`Chunk ${chunkIndex + 1} for "${fileName}" saved successfully.`);

        // Emit the chunk to the public server
        socket.emit('file-share', { 
            fileName, 
            fileData, 
            chunkIndex, 
            totalChunks 
        }, enteredUUID);

        console.log(`Chunk ${chunkIndex + 1} of file "${fileName}" has been sent to the public server.`);

        // Check if this is the last chunk
        if (chunkIndex + 1 === totalChunks) {
            console.log(`All chunks for "${fileName}" have been uploaded successfully.`);
            event.reply('upload-complete', { fileName, enteredUUID });
        }
    });
});
    // Handle server disconnection
    socket.on('server-stopSharing', async () => {
        console.log('Server Disconnected from public server');
        // setTimeout(() => {
            win.webContents.send('server-disconnected');

        // }, 500);

        // win.webContents.send('server-status', 'Disconnected from public server');
        // win.webContents.send('reconnect_attempt_public', 'Attempting to reconnect to public server...');
        const biosSerialNumber = await getBiosSerialNumber();
        console.log(`1BIOS Serial Number: ${biosSerialNumber}`);
        socket.emit('registerClient', { biosSerialNumber });
        
    });

    function scaleCoordinates(x, y) {
    

        const scaledX =x;
        const scaledY = y;
        return { x: x, y: y };
    }

    socket.on('mouse-label', (coordinates,label) => {
        const { x, y } = scaleCoordinates(coordinates.x, coordinates.y);
        if (win.isMaximized()) {
            // console.log('maximized');
            win.webContents.send('update-mouse-label', { x, y, label });

        } else {
            // console.log('minimized');

        }
            // console.log('coordinates:',{ x, y },', label: ',label);
         
    });

    // Handle UUID matching
    socket.on('uuidMatch', () => {
        // if (isMatch) {
            console.log('UUID matched! Connected to system.');
            win.webContents.send('uuid-status', 'UUID matched! Connected to server.');
        // } else {
        //     console.log('UUID mismatch. Please try again.');
        //     win.webContents.send('uuid-status', 'UUID mismatch. Please try again...!');
        // }
    });
    socket.on('noServer', () => {
        console.log('No Server Granted Access!');
        win.webContents.send('noServerAvail', 'No Server available to take access.');
    });

    socket.on('uuidMisMatch', () => {
        console.log('UUID mismatch. Please try again.');
        win.webContents.send('uuid-status', 'UUID mismatch. Please try again.!');
    });
    socket.on('client-disconnected-received', async () => {
        const biosSerialNumber = await getBiosSerialNumber();
        console.log(`2BIOS Serial Number: ${biosSerialNumber}`);
        socket.emit('registerClient', { biosSerialNumber });

        console.log('disconnect received. Please try uuid again.');
        setTimeout(() => {
        win.webContents.send('client-disconnect-received',"0");
        }, 200); // 2000 milliseconds = 2 seconds
    });

    
    socket.on('receive-file', async(data) => {
        const { biosnumber, fileName, fileData } = data;
        console.log('rescieved for',biosnumber);
        // Get the system BIOS number
        const systemBiosNumber = await getBiosSerialNumber();
            console.log(`System BIOS Number: ${systemBiosNumber}`);
            console.log(`Received BIOS Number: ${biosnumber}`);
            
            // Check if they match
            if (systemBiosNumber === biosnumber) {
                console.log(`Bios numbers match. Proceeding to save the file...`);
                
                // Decode base64 file data
                // console.log('BASSSEEE : ',fileData);
                
                // const buffer = Buffer.from(fileData, 'base64');

                console.log('Original fileData:', fileData);
        
                // Extract Base64 data
                const parts = fileData.split('base64,');
                const base64Data = parts.length > 1 ? parts[1] : fileData; // Get Base64 part or original if not valid
                
                // Decode base64 file data
                const buffer = Buffer.from(base64Data, 'base64');
                const downloadsPath = path.join(os.homedir(), 'Downloads', fileName).toString();
                const filepath = path.join(os.homedir(), 'Downloads').toString();
                console.log('donwload path:',downloadsPath);
                // Write the file to the Downloads folder
                fs.writeFile(downloadsPath, buffer, (err) => {
                    if (err) {
                        console.error('Failed to save the file:', err);
                    } else {
                        console.log(`File saved successfully to ${filepath}`);
                        win.webContents.send('file-received-server', {
                            message: `"${fileName}" has been received.  Click to open !  ${filepath}`,
                            folderPath: filepath,
                        });

                    }
                });
            } else {
                console.log(`Bios numbers do not match. File will not be downloaded.`);
            }
         
    });
    
        // Listen for 'open-folder' event with the folder path
        ipcMain.on('open-folder', (event, folderPath) => {
            if (folderPath) {
                console.log(`open folder path : ${folderPath}`);
                shell.openPath(folderPath);
            } else {
                console.log("No valid folder path provided.");
            }
        });

    //mouse-event
    ipcMain.on('mouse-move', async(event,coordinates,enteredUUID) => {
        // console.log(`Mouse moved to X: ${coordinates.x}, Y: ${coordinates.y}`);
        // console.log('mouse-moving'); // Log the disconnection event
        const biosSerialNumber = await getBiosSerialNumber();

        socket.emit('mouse-move',coordinates,enteredUUID,biosSerialNumber);
        
         
    });

    ipcMain.on('mouse-click', (event,coordinates,enteredUUID) => {
        // console.log(`Mouse clicked to X: ${coordinates.x}, Y: ${coordinates.y}`);
        // console.log('mouse-moving'); // Log the disconnection event
        socket.emit('mouse-click',coordinates,enteredUUID);
        
         
    });

    


    ipcMain.on('key-press', (event,key,enteredUUID) => {
        // console.log(`Key Pressed: ${key}`);
        // console.log('mouse-moving'); // Log the disconnection event
        socket.emit('key-press',key,enteredUUID);
        
         
    });
    

    // Handle incoming screenshots
    // socket.on('screenshot', (imgBase64) => {
    //     console.log('screen sharing...');
    //     win.webContents.send('screenshot', imgBase64); // Send screenshot to renderer process
    // });

    
    socket.on('screenshot', (imgBase64) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('screenshot', imgBase64); // Send screenshot to renderer process
        } else {
            console.error("Window has been destroyed, cannot send screenshot.");
        }
    });

});



// Listen for UUID submission from renderer
ipcMain.on('submit-uuid', async(event, uuid) => {
    const biosSerialNumber = await getBiosSerialNumber();
    systemUuid=uuid;

    console.log('checking uuid');
    socket.emit('checkUUID', uuid,biosSerialNumber); // Check UUID with the public server
});
ipcMain.on('disconnect-client', async(event,enteredUUID) => {
    const biosSerialNumber = await getBiosSerialNumber();
        
    console.log('Client disconnected..! uuid',enteredUUID); // Log the disconnection event
    socket.emit('disconnect-client',biosSerialNumber,enteredUUID);
    
     
});
// Handle client disconnect when app is closed
// Handle app exit
app.on('before-quit', async () => {
    try {
        disconnectSocket();
    } catch (error) {
        console.error('Error during disconnecting:', error);
    }
});
function disconnectSocket() {
    if (socket && socket.connected) {
        console.log(`Disconnecting with BIOS Serial Number: ${systemBios} and UUID: ${systemUuid}`);
        socket.emit('disconnect-client', systemBios, systemUuid);
     
    }
}


ipcMain.on('request-bios-number', async (event) => {
    const biosNumber = await getBiosSerialNumber(); // Replace with your actual BIOS retrieval function
    console.log('biosN',biosNumber);
    win.webContents.send('update-bios-number', biosNumber);
});
// Function to get BIOS serial number
function getBiosSerialNumber() {
    return new Promise((resolve, reject) => {
        // Execute the WMIC command
        exec('wmic bios get serialnumber', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error retrieving BIOS serial number: ${error}`);
                return reject(error); // Reject the promise on error
            }
            // Process the output to extract the serial number
            const serialNumber = stdout.split('\n')[1]?.trim(); // Get the second line
            if (serialNumber) {
                resolve(serialNumber); // Resolve the promise with the serial number
            } else {
                reject(new Error('Unable to retrieve BIOS serial number'));
            }
        });
    });
}

// Handle app exit
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});