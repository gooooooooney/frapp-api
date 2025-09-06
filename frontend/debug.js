// Debug script to check if everything is working
console.log('=== Frontend Debug Check ===');
console.log('1. 页面元素检查:');
console.log('- 录音按钮:', !!document.getElementById('recordBtn'));
console.log('- WebSocket URL 字段:', !!document.getElementById('wsUrl'));
console.log('- WebSocket Ticket 字段:', !!document.getElementById('wsTicket'));
console.log('- 设置面板:', !!document.getElementById('controlPanel'));

console.log('\n2. 当前设置值:');
const wsUrl = document.getElementById('wsUrl');
const wsTicket = document.getElementById('wsTicket');
console.log('- WebSocket URL:', wsUrl ? wsUrl.value : 'null');
console.log('- WebSocket Ticket:', wsTicket ? wsTicket.value : 'null');

console.log('\n3. 全局函数检查:');
console.log('- toggleRecording:', typeof window.toggleRecording);
console.log('- getWebSocketTicket:', typeof getWebSocketTicket);
console.log('- testWebSocketConnection:', typeof testWebSocketConnection);

console.log('\n4. VAD 检查:');
console.log('- VAD 模块加载:', !!window.globalStreamingVAD);
console.log('- VAD 初始化状态:', window.globalStreamingVAD ? window.globalStreamingVAD.isInitialized : 'N/A');

console.log('\n5. Audio 模块检查:');
console.log('- audioProcessor:', !!window.audioProcessor);
console.log('- connectWebSocket:', typeof window.connectWebSocket);

console.log('\n如果要显示设置面板，请运行: togglePanel()');