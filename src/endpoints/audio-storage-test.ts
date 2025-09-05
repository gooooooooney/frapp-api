// 音频存储系统测试页面
import { Context } from 'hono';

/**
 * 音频存储测试页面
 * 提供简单的HTML界面来测试音频存储功能
 */
export async function handleAudioStorageTest(c: Context): Promise<Response> {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>音频存储系统测试</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
        }
        .section {
            margin-bottom: 40px;
            padding: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
        }
        .section h2 {
            margin-top: 0;
            color: #555;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin: 5px;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .status {
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
        }
        .status.success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        .status.error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        .status.info {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            color: #0c5460;
        }
        .json-display {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 5px;
            padding: 15px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
        }
        input[type="text"] {
            width: 200px;
            padding: 8px;
            margin: 5px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 音频存储系统测试</h1>
        
        <div class="section">
            <h2>📊 存储统计</h2>
            <button onclick="getStorageStats()">获取存储统计</button>
            <div id="stats-status"></div>
            <div id="stats-display"></div>
        </div>

        <div class="section">
            <h2>👤 用户文件管理</h2>
            <input type="text" id="user-id" placeholder="输入用户ID" value="test-user">
            <button onclick="getUserFiles()">获取用户文件</button>
            <div id="files-status"></div>
            <div id="files-display"></div>
        </div>

        <div class="section">
            <h2>🧹 清理管理</h2>
            <input type="text" id="max-age" placeholder="保留天数" value="7">
            <button onclick="cleanupFiles()">清理过期文件</button>
            <div id="cleanup-status"></div>
            <div id="cleanup-display"></div>
        </div>

        <div class="section">
            <h2>🔍 系统信息</h2>
            <button onclick="getSystemInfo()">获取系统信息</button>
            <div id="system-status"></div>
            <div id="system-display"></div>
        </div>
    </div>

    <script>
        // 显示状态消息
        function showStatus(elementId, message, type = 'info') {
            const element = document.getElementById(elementId);
            element.innerHTML = '<div class="status ' + type + '">' + message + '</div>';
        }

        // 显示JSON数据
        function showJson(elementId, data) {
            const element = document.getElementById(elementId);
            element.innerHTML = '<div class="json-display">' + JSON.stringify(data, null, 2) + '</div>';
        }

        // 获取存储统计
        async function getStorageStats() {
            showStatus('stats-status', '正在获取存储统计...', 'info');
            try {
                const response = await fetch('/api/audio-storage/stats');
                const data = await response.json();
                
                if (data.success) {
                    showStatus('stats-status', '✅ 存储统计获取成功', 'success');
                    showJson('stats-display', data.data);
                } else {
                    showStatus('stats-status', '❌ 获取失败: ' + data.error, 'error');
                }
            } catch (error) {
                showStatus('stats-status', '❌ 网络错误: ' + error.message, 'error');
            }
        }

        // 获取用户文件
        async function getUserFiles() {
            const userId = document.getElementById('user-id').value;
            if (!userId) {
                showStatus('files-status', '⚠️ 请输入用户ID', 'error');
                return;
            }

            showStatus('files-status', '正在获取用户文件...', 'info');
            try {
                const response = await fetch('/api/audio-storage/files/' + encodeURIComponent(userId));
                const data = await response.json();
                
                if (data.success) {
                    showStatus('files-status', '✅ 用户文件获取成功', 'success');
                    showJson('files-display', data.data);
                } else {
                    showStatus('files-status', '❌ 获取失败: ' + data.error, 'error');
                }
            } catch (error) {
                showStatus('files-status', '❌ 网络错误: ' + error.message, 'error');
            }
        }

        // 清理过期文件
        async function cleanupFiles() {
            const maxAge = parseInt(document.getElementById('max-age').value) || 7;
            
            showStatus('cleanup-status', '正在清理过期文件...', 'info');
            try {
                const response = await fetch('/api/audio-storage/cleanup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ maxAgeDays: maxAge })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showStatus('cleanup-status', '✅ 清理完成', 'success');
                    showJson('cleanup-display', data.data);
                } else {
                    showStatus('cleanup-status', '❌ 清理失败: ' + data.error, 'error');
                }
            } catch (error) {
                showStatus('cleanup-status', '❌ 网络错误: ' + error.message, 'error');
            }
        }

        // 获取系统信息
        async function getSystemInfo() {
            showStatus('system-status', '正在获取系统信息...', 'info');
            try {
                const response = await fetch('/api/info');
                const data = await response.json();
                
                showStatus('system-status', '✅ 系统信息获取成功', 'success');
                showJson('system-display', data);
            } catch (error) {
                showStatus('system-status', '❌ 网络错误: ' + error.message, 'error');
            }
        }

        // 页面加载时自动获取存储统计
        window.addEventListener('load', () => {
            getStorageStats();
        });
    </script>
</body>
</html>
  `;

  return c.html(html);
}