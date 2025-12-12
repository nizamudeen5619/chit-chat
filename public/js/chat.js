const socket = io()

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
            // Regular message
            const html = Mustache.render(messageTemplate, {
                username: message.username,
                message: message.text,
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
    const html = Mustache.render(messageTemplate, {
        username: message.username,
        message: message.text,
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
    socket.emit('sendMessage', message, (error) => {
        $messageFormButton.removeAttribute('disabled')
        $messageFormInput.value = ''
        $messageFormInput.focus()
        //acknowledgement
        if (error) {
            return console.log(error);
        }
        console.log('Message Delivered');
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
            console.log('Location Shared!');
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

socket.emit('join', { username, room }, (error) => {
    if (error) {
        window.alert(error)
        location.href = '/'
    }
})