// Clerk authentication test page
import type { Context } from 'hono';

export function handleTestPage(c: Context): Response {
  const publishableKey = c.env.CLERK_PUBLISHABLE_KEY || 'pk_test_your_key_here';
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clerk Auth Test</title>
    <script
        async
        crossorigin="anonymous"
        data-clerk-publishable-key="${publishableKey}"
        src="https://unpkg.com/@clerk/clerk-js@latest/dist/clerk.browser.js"
        type="text/javascript"
    ></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            max-width: 600px;
            margin: 2rem auto;
            padding: 1rem;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        button {
            background: #5d4fb3;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            cursor: pointer;
            margin: 0.5rem 0.5rem 0.5rem 0;
        }
        button:hover { background: #4c3a9b; }
        button:disabled { 
            background: #ccc; 
            cursor: not-allowed; 
        }
        .token-display {
            background: #f8f9fa;
            border: 1px solid #ddd;
            padding: 1rem;
            border-radius: 4px;
            margin-top: 1rem;
            word-break: break-all;
            font-family: monospace;
            font-size: 0.85rem;
        }
        .user-info {
            background: #e3f2fd;
            padding: 1rem;
            border-radius: 4px;
            margin-top: 1rem;
        }
        .status {
            padding: 0.5rem;
            border-radius: 4px;
            margin-top: 1rem;
        }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Clerk Auth Test</h1>
        <p>用于获取 JWT token 测试 API</p>
        
        <div id="clerk-loaded" style="display: none;">
            <div id="signed-out" style="display: none;">
                <h2>请先登录</h2>
                <button onclick="signIn()">登录</button>
                <button onclick="signUp()">注册</button>
            </div>
            
            <div id="signed-in" style="display: none;">
                <h2>✅ 已登录</h2>
                <div id="user-info" class="user-info"></div>
                
                <h3>获取测试 Token</h3>
                <button onclick="getToken()">获取默认 Token</button>
                <button onclick="getTestToken()">获取测试模板 Token</button>
                <button onclick="signOutUser()">退出登录</button>
                
                <div id="token-display" class="token-display" style="display: none;"></div>
                <div id="status"></div>
            </div>
        </div>
        
        <div id="loading">
            <p>正在加载 Clerk SDK...</p>
        </div>
    </div>

    <script>
        // 初始化 Clerk
        const clerkPublishableKey = "${publishableKey}";
        
        window.addEventListener('load', async () => {
            try {
                if (!window.Clerk) {
                    throw new Error('Clerk SDK 未加载')
                }
                
                // Clerk SDK 已经通过 data-clerk-publishable-key 自动初始化
                await window.Clerk.load();
                console.log('ClerkJS is loaded')

                document.getElementById('loading').style.display = 'none';
                document.getElementById('clerk-loaded').style.display = 'block';
                
                // 检查登录状态
                checkAuthState();
                
                // 监听认证状态变化
                window.Clerk.addListener(checkAuthState);
                
            } catch (error) {
                console.error('Clerk 初始化失败:', error);
                showStatus('Clerk 初始化失败: ' + error.message, 'error');
            }
        });
        
        function checkAuthState() {
            const user = window.Clerk.user;
            const session = window.Clerk.session;
            
            if (user && session) {
                document.getElementById('signed-out').style.display = 'none';
                document.getElementById('signed-in').style.display = 'block';
                
                // 显示用户信息
                document.getElementById('user-info').innerHTML = \`
                    <strong>用户ID:</strong> \${user.id}<br>
                    <strong>邮箱:</strong> \${user.primaryEmailAddress?.emailAddress || 'N/A'}<br>
                    <strong>姓名:</strong> \${user.fullName || 'N/A'}
                \`;
            } else {
                document.getElementById('signed-out').style.display = 'block';
                document.getElementById('signed-in').style.display = 'none';
            }
        }
        
        function signIn() {
            try {
                window.Clerk.openSignIn();
            } catch (error) {
                showStatus('登录失败: ' + error.message, 'error');
            }
        }
        
        function signUp() {
            try {
                window.Clerk.openSignUp();
            } catch (error) {
                showStatus('注册失败: ' + error.message, 'error');
            }
        }
        
        async function signOutUser() {
            try {
                await window.Clerk.signOut();
                document.getElementById('token-display').style.display = 'none';
                showStatus('已退出登录', 'success');
            } catch (error) {
                showStatus('退出失败: ' + error.message, 'error');
            }
        }
        
        async function getToken() {
            try {
                const token = await window.Clerk.session.getToken();
                displayToken('默认 Token', token);
                showStatus('✅ 默认 Token 获取成功！', 'success');
            } catch (error) {
                showStatus('Token 获取失败: ' + error.message, 'error');
            }
        }
        
        async function getTestToken() {
            try {
                const token = await window.Clerk.session.getToken({ template: 'test' });
                displayToken('测试模板 Token', token);
                showStatus('✅ 测试 Token 获取成功！', 'success');
            } catch (error) {
                showStatus('测试 Token 获取失败: ' + error.message + ' (请确保在 Clerk Dashboard 中创建了名为 "test" 的 JWT 模板)', 'error');
            }
        }
        
        function displayToken(title, token) {
            const display = document.getElementById('token-display');
            display.innerHTML = \`
                <strong>\${title}:</strong><br>
                <div style="margin-top: 0.5rem; color: #333;">\${token}</div>
                <br>
                <small style="color: #666;">
                    💡 提示：复制此 token，在 Postman/Insomnia 中设置 Authorization: Bearer YOUR_TOKEN
                </small>
            \`;
            display.style.display = 'block';
            
            // 自动复制到剪贴板
            navigator.clipboard.writeText(token).then(() => {
                showStatus('Token 已复制到剪贴板！', 'success');
            }).catch(() => {
                console.log('无法自动复制，请手动复制');
            });
        }
        
        function showStatus(message, type) {
            const status = document.getElementById('status');
            status.innerHTML = message;
            status.className = 'status ' + type;
            
            // 3秒后清除状态
            setTimeout(() => {
                status.innerHTML = '';
                status.className = 'status';
            }, 3000);
        }
    </script>
</body>
</html>`;
  
  return c.html(html);
}