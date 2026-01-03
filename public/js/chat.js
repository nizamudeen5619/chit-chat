const socket = io()

// Initialize encryption
const encryption = new ClientEncryption()

//Elements
const $messageForm = document.querySelector('#msg-form')
const $messageFormInput = $messageForm.querySelector('input')
const $messageFormButton = $messageForm.querySelector('button')
const $sendLocationButton = document.querySelector('#share-location')
const $message = document.querySelector('#message')
const $sidebar = document.querySelector('#sidebar')
const $sidebarToggle = document.querySelector('#sidebar-toggle')
const $sidebarOverlay = document.querySelector('#sidebar-overlay')
const $scrollToBottom = document.querySelector('#scroll-to-bottom')

//Templates
const messageTemplate = document.querySelector('#message-template').innerHTML
const locationMessageTemplate = document.querySelector('#location-message-template').innerHTML
const sidebarTemplate = document.querySelector('#sidebar-template').innerHTML

//Options
const { username, room } = Qs.parse(location.search, { ignoreQueryPrefix: true })

// Check if user is at bottom of messages
const isAtBottom = () => {
    const threshold = 100 // pixels from bottom to consider "at bottom"
    const scrollTop = $message.scrollTop
    const scrollHeight = $message.scrollHeight
    const clientHeight = $message.clientHeight
    
    return (scrollHeight - scrollTop - clientHeight) < threshold
}

// Show or hide scroll to bottom button
const updateScrollButton = () => {
    if (isAtBottom()) {
        $scrollToBottom.classList.remove('visible')
    } else {
        $scrollToBottom.classList.add('visible')
    }
}

const scrollToBottom = () => {
    $message.scrollTop = $message.scrollHeight
    updateScrollButton()
}

const autoScroll = () => {
    // Only auto-scroll if user is already at bottom
    if (isAtBottom()) {
        $message.scrollTop = $message.scrollHeight
    }
    updateScrollButton()
}

// Listen for scroll events to show/hide scroll button
$message.addEventListener('scroll', updateScrollButton)

// Scroll to bottom button click handler
$scrollToBottom.addEventListener('click', scrollToBottom)

socket.on('previousMessages', (messages) => {
    messages.forEach((message) => {
        if (message.url) {
            // Location message
            const html = Mustache.render(locationMessageTemplate, {
                username: message.username,
                url: message.url,
                createdAt: moment(message.createdAt).format('MMM Do YYYY, h:mm a'),
                isAdmin: message.username.toLowerCase() === 'admin'
            })
            $message.insertAdjacentHTML('beforeend', html)
        } else if (message.text) {
            // Regular message - try to decrypt if encrypted
            let decryptedMessage = message.text;
            try {
                if (encryption.isEncrypted(message.text)) {
                    decryptedMessage = encryption.decryptMessage(message.text, room);
                }
            } catch (error) {
                decryptedMessage = '[Encrypted - Unable to decrypt]';
            }
            
            const html = Mustache.render(messageTemplate, {
                username: message.username,
                message: decryptedMessage,
                createdAt: moment(message.createdAt).format('MMM Do YYYY, h:mm a'),
                isAdmin: message.username.toLowerCase() === 'admin'
            })
            $message.insertAdjacentHTML('beforeend', html)
        }
    })
    // Always scroll to bottom when loading previous messages
    scrollToBottom()
})

socket.on('message', (message) => {
    // Try to decrypt if encrypted
    let decryptedMessage = message.text;
    try {
        if (encryption.isEncrypted(message.text)) {
            decryptedMessage = encryption.decryptMessage(message.text, room);
        }
    } catch (error) {
        decryptedMessage = '[Encrypted - Unable to decrypt]';
    }
    
    const html = Mustache.render(messageTemplate, {
        username: message.username,
        message: decryptedMessage,
        createdAt: moment(message.createdAt).format('MMM Do YYYY, h:mm a'),
        isAdmin: message.username.toLowerCase() === 'admin'
    })
    $message.insertAdjacentHTML('beforeend', html)
    autoScroll()
})

socket.on('locationMessage', (message) => {
    const html = Mustache.render(locationMessageTemplate, {
        username: message.username,
        url: message.url,
        createdAt: moment(message.createdAt).format('MMM Do YYYY, h:mm a'),
        isAdmin: message.username.toLowerCase() === 'admin'
    })
    $message.insertAdjacentHTML('beforeend', html)
    autoScroll()
})

socket.on('roomData', ({ room, users }) => {
    const html = Mustache.render(sidebarTemplate, {
        room,
        users
    })
    document.querySelector('#sidebar').innerHTML = html
})

$messageForm.addEventListener('submit', (event) => {
    event.preventDefault()

    $messageFormButton.setAttribute('disabled', 'disabled')

    const message = event.target.elements.message.value
    
    // Check if room key is available before attempting encryption
    const roomKey = encryption.getRoomKey(room);
    if (!roomKey) {
        $messageFormButton.removeAttribute('disabled')
        return alert('Encryption key not yet established. Please wait a moment and try again.');
    }
    
    // Encrypt message before sending
    let encryptedMessage;
    try {
        encryptedMessage = encryption.encryptMessage(message, room);
    } catch (error) {
        $messageFormButton.removeAttribute('disabled')
        return alert('Failed to encrypt message. Please try again.');
    }
    
    socket.emit('sendMessage', encryptedMessage, (error) => {
        $messageFormButton.removeAttribute('disabled')
        $messageFormInput.value = ''
        $messageFormInput.focus()
        //acknowledgement
        if (error) {
            return;
        }
    })
})

$sendLocationButton.addEventListener('click', () => {
    $sendLocationButton.setAttribute('disabled', 'disabled')
    if (!navigator.geolocation) {
        return window.alert('Geolocation is not supported by your browser')
    }
    navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude } = position.coords
        socket.emit('sendLocation', { latitude, longitude }, () => {
            $sendLocationButton.removeAttribute('disabled')
        })
    })
})

// Sidebar toggle functionality
$sidebarToggle.addEventListener('click', () => {
    $sidebar.classList.toggle('active')
    $sidebarOverlay.classList.toggle('active')
})

// Close sidebar when clicking overlay
$sidebarOverlay.addEventListener('click', () => {
    $sidebar.classList.remove('active')
    $sidebarOverlay.classList.remove('active')
})

// Exit button functionality (using event delegation since button is dynamically added)
$sidebar.addEventListener('click', (e) => {
    if (e.target.id === 'exit-button' || e.target.closest('#exit-button')) {
        // Clear session storage
        sessionStorage.removeItem('chatUsername')
        sessionStorage.removeItem('chatRoom')
        // Redirect to index page
        window.location.href = '/index.html'
    }
})

// Listen for key exchange events
socket.on('userPublicKey', (data) => {
    encryption.storeUserPublicKey(data.username, data.publicKey);
})

socket.on('roomKey', (data) => {
    try {
        const decryptedKey = encryption.decryptRoomKeyFromUser(data.encryptedKey, data.senderPublicKey);
        encryption.storeRoomKey(room, decryptedKey);
        
        // Enable message form and show encryption ready status
        $messageFormInput.removeAttribute('disabled');
        $messageFormButton.removeAttribute('disabled');
        updateEncryptionStatus(true);
    } catch (error) {
        // Decryption failed
    }
})

socket.on('requestRoomKey', (data) => {
    try {
        const roomKey = encryption.getRoomKey(room);
        if (roomKey) {
            const encryptedKey = encryption.encryptRoomKeyForUser(roomKey, data.publicKey);
            socket.emit('provideRoomKey', {
                targetUser: data.username,
                encryptedKey: encryptedKey
            });
        }
    } catch (error) {
        // Failed to encrypt room key
    }
})

socket.on('encryptionReady', (data) => {
    // Store the room key if provided by server
    if (data && data.roomKey) {
        encryption.storeRoomKey(room, data.roomKey);
    }
    
    $messageFormInput.removeAttribute('disabled');
    $messageFormButton.removeAttribute('disabled');
    updateEncryptionStatus(true);
})

// Function to update encryption status
const updateEncryptionStatus = (isReady) => {
    const statusElement = document.querySelector('#encryption-status');
    if (!statusElement) {
        // Create status element if it doesn't exist
        const statusDiv = document.createElement('div');
        statusDiv.id = 'encryption-status';
        statusDiv.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            z-index: 1000;
            transition: all 0.3s ease;
        `;
        document.body.appendChild(statusDiv);
    }
    
    const statusEl = document.querySelector('#encryption-status');
    if (isReady) {
        statusEl.textContent = '🔒 Encryption Active';
        statusEl.style.backgroundColor = '#4CAF50';
        statusEl.style.color = 'white';
    } else {
        statusEl.textContent = '🔓 Establishing Encryption...';
        statusEl.style.backgroundColor = '#FF9800';
        statusEl.style.color = 'white';
    }
};

// Initialize encryption status
updateEncryptionStatus(false);

// Disable message form initially until encryption is ready
$messageFormInput.setAttribute('disabled', 'disabled');
$messageFormButton.setAttribute('disabled', 'disabled');

socket.emit('join', { username, room, publicKey: encryption.getPublicKey() }, (error) => {
    if (error) {
        window.alert(error)
        location.href = '/'
    }
})