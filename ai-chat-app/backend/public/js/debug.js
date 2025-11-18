// Quick button test - add this temporarily to debug
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔧 Button Debug Test Starting...');
    
    // Test all buttons on the page
    const buttons = document.querySelectorAll('button');
    console.log(`Found ${buttons.length} buttons`);
    
    buttons.forEach((btn, index) => {
        console.log(`Button ${index}:`, {
            id: btn.id,
            className: btn.className,
            disabled: btn.disabled,
            innerText: btn.innerText.substring(0, 20)
        });
        
        // Add test click listener
        btn.addEventListener('click', (e) => {
            console.log(`🖱️ Button clicked: ${btn.id || btn.className}`);
        });
    });
    
    // Specifically test send button
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        console.log('✅ Send button found');
        sendBtn.addEventListener('click', () => {
            console.log('🚀 Send button DEFINITELY clicked!');
            alert('Send button works!');
        });
    } else {
        console.log('❌ Send button NOT found');
    }
    
    // Test message input
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        console.log('✅ Message input found');
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                console.log('🎯 Enter key pressed in input!');
                alert('Enter key works!');
            }
        });
    } else {
        console.log('❌ Message input NOT found');
    }
});