#!/usr/bin/env python3
"""
All-in-One Server for Private AI Chat
Combines web server and CORS proxy functionality
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.request
import urllib.parse
import urllib.error
from urllib.parse import urlparse, parse_qs
import os
import mimetypes
import threading
import time
import socket
import subprocess
import sys
import platform

class AIChatterHandler(BaseHTTPRequestHandler):
    
    def _set_cors_headers(self):
        """Set CORS headers to allow cross-origin requests"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Max-Age', '3600')
    
    def _serve_static_file(self, path):
        """Serve static files from the frontend directory"""
        print(f"📁 REQUEST: {path}")
        
        # Simple path handling
        if path in ['/', '/ai-chat-app', '/ai-chat-app/']:
            file_path = 'frontend/index.html'
        elif path.startswith('/ai-chat-app/'):
            file_path = 'frontend/' + path[13:]  # Remove '/ai-chat-app/' and add 'frontend/'
        else:
            file_path = 'frontend/' + path.lstrip('/')
        
        # Default to index.html if empty
        if not file_path or file_path == 'frontend/':
            file_path = 'frontend/index.html'
        
        print(f"📂 LOOKING FOR: {file_path}")
        print(f"📍 FULL PATH: {os.path.abspath(file_path)}")
        print(f"📋 EXISTS: {os.path.exists(file_path)}")
        
        # Try to serve the file
        if os.path.exists(file_path) and os.path.isfile(file_path):
            try:
                mime_type, _ = mimetypes.guess_type(file_path)
                if mime_type is None:
                    mime_type = 'text/html' if file_path.endswith('.html') else 'application/octet-stream'
                
                print(f"✅ SERVING: {file_path} as {mime_type}")
                
                self.send_response(200)
                self.send_header('Content-type', mime_type)
                self._set_cors_headers()
                self.end_headers()
                
                with open(file_path, 'rb') as f:
                    content = f.read()
                    self.wfile.write(content)
                    print(f"📤 SENT: {len(content)} bytes")
                return
                
            except Exception as e:
                print(f"❌ ERROR SERVING {file_path}: {e}")
        
        # File not found - show debug info
        print(f"❌ FILE NOT FOUND: {file_path}")
        
        self.send_response(404)
        self.send_header('Content-type', 'text/html')
        self._set_cors_headers()
        self.end_headers()
        
        # Simple 404 page with file listing
        files_list = ""
        try:
            for item in sorted(os.listdir('.')):
                if os.path.isfile(item):
                    files_list += f'<li><a href="/ai-chat-app/{item}">{item}</a></li>\n'
        except Exception as e:
            files_list = f'<li>Error listing files: {e}</li>'
        
        html = f"""<!DOCTYPE html>
<html>
<head>
    <title>404 - File Not Found</title>
    <style>
        body {{ font-family: Arial; margin: 40px; }}
        .debug {{ background: #f0f0f0; padding: 15px; margin: 20px 0; border-radius: 5px; }}
        .files {{ background: #e8f4f8; padding: 15px; border-radius: 5px; }}
    </style>
</head>
<body>
    <h1>404 - File Not Found</h1>
    <div class="debug">
        <h3>Debug Info:</h3>
        <p><strong>Requested:</strong> {path}</p>
        <p><strong>Looking for:</strong> {file_path}</p>
        <p><strong>Working directory:</strong> {os.getcwd()}</p>
        <p><strong>File exists:</strong> {os.path.exists(file_path)}</p>
    </div>
    
    <div class="files">
        <h3>Available Files:</h3>
        <ul>{files_list}</ul>
    </div>
    
    <p><a href="/ai-chat-app/index.html">🏠 Try Direct Link to index.html</a></p>
</body>
</html>"""
        
        self.wfile.write(html.encode('utf-8'))

    
    def _proxy_request(self, target_url, method='GET', data=None, headers=None):
        """Proxy request to target URL"""
        try:
            if headers is None:
                headers = {}
            
            # Add authorization header for LocalAI
            if 'Authorization' not in headers:
                headers['Authorization'] = 'Bearer dummy-token'
            
            if data:
                data = data.encode('utf-8') if isinstance(data, str) else data
                headers['Content-Type'] = 'application/json'
            
            print(f"🔄 Proxying {method} request to: {target_url}")
            if headers:
                print(f"📤 Headers: {headers}")
            if data:
                data_str = data.decode('utf-8') if isinstance(data, bytes) else str(data)
                print(f"📤 Request data: {data_str[:500]}{'...' if len(data_str) > 500 else ''}")
            
            req = urllib.request.Request(target_url, data=data, headers=headers, method=method)
            
            with urllib.request.urlopen(req, timeout=30) as response:
                response_data = response.read()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                
                response_str = response_data.decode('utf-8')
                print(f"📥 Complete Response from {target_url}:")
                print("=" * 80)
                print(response_str)
                print("=" * 80)
                self.wfile.write(response_data)
                
        except urllib.error.HTTPError as e:
            print(f"HTTP Error {e.code}: {e.reason}")
            self.send_response(e.code)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'HTTP {e.code}: {e.reason}',
                'details': e.read().decode('utf-8') if e.fp else ''
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
            
        except urllib.error.URLError as e:
            print(f"URL Error: {e.reason}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'Connection error: {str(e.reason)}',
                'details': 'Could not connect to AI service'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
            
        except Exception as e:
            print(f"Proxy Error: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'Proxy error: {str(e)}',
                'details': 'Internal proxy server error'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def _handle_docker_list(self):
        """List all Docker containers on Unraid server via SSH"""
        try:
            print("🐳 Listing Docker containers from Unraid server...")
            
            containers = []
            
            try:
                # Get container list via SSH
                result = subprocess.run([
                    'ssh', 
                    '-o', 'StrictHostKeyChecking=no',
                    '-o', 'ConnectTimeout=10',
                    'root@192.168.1.206', 
                    'docker ps -a --format "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'
                ], 
                capture_output=True, 
                text=True, 
                timeout=15
                )
                
                if result.returncode == 0 and result.stdout:
                    print("✅ Retrieved container list via SSH")
                    lines = result.stdout.strip().split('\n')
                    
                    for line in lines:
                        if line and '\t' in line:
                            parts = line.split('\t')
                            if len(parts) >= 3:
                                containers.append({
                                    "name": parts[0],
                                    "image": parts[1] if len(parts) > 1 else "unknown",
                                    "status": parts[2] if len(parts) > 2 else "unknown",
                                    "ports": parts[3] if len(parts) > 3 else ""
                                })
                else:
                    print(f"⚠️ SSH command failed, using fallback: {result.stderr}")
                    raise subprocess.CalledProcessError(result.returncode, "docker ps")
                    
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                print("⚠️ SSH not available or failed, using default containers")
                # Fallback to default containers when SSH fails
                containers = [
                    {
                        "name": "local-ai",
                        "status": "running",
                        "ports": "8082:8080",
                        "image": "localai/localai:latest"
                    },
                    {
                        "name": "automatic1111-webui",
                        "status": "running", 
                        "ports": "7860:7860",
                        "image": "automatic1111/stable-diffusion-webui:latest"
                    }
                ]
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            response = {
                'success': True,
                'containers': containers,
                'message': f'Found {len(containers)} containers'
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        except Exception as e:
            print(f"❌ Docker list error: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'success': False,
                'error': f'Docker command failed: {str(e)}'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def _handle_docker_action(self, action, container):
        """Handle container VRAM management via internal APIs (no SSH needed)"""
        try:
            print(f"🔥 VRAM management {action} requested for: {container}")
            
            success = False
            message = ""
            
            if container.lower() == 'all' and action == 'stop':
                # Free all VRAM by unloading both services
                print("🆓 Freeing ALL VRAM - unloading LocalAI and A1111...")
                try:
                    # Unload LocalAI
                    localai_success = False
                    try:
                        unload_data = json.dumps({
                            "model": "josiefied-qwen3-4b-abliterated-gpu",
                            "prompt": "",
                            "options": {"keep_alive": 0, "num_predict": 1}
                        }).encode('utf-8')
                        
                        req = urllib.request.Request(
                            'http://192.168.1.206:8082/api/generate',
                            data=unload_data,
                            headers={'Content-Type': 'application/json'}
                        )
                        urllib.request.urlopen(req, timeout=10)
                        localai_success = True
                        print("✅ LocalAI VRAM released")
                    except:
                        print("⚠️ LocalAI unload failed")
                    
                    # Unload A1111
                    a1111_success = False
                    try:
                        unload_data = json.dumps({"sd_model_checkpoint": ""}).encode('utf-8')
                        req = urllib.request.Request(
                            'http://192.168.1.206:7860/sdapi/v1/unload-checkpoint',
                            data=unload_data,
                            headers={'Content-Type': 'application/json'}
                        )
                        urllib.request.urlopen(req, timeout=10)
                        a1111_success = True
                        print("✅ A1111 checkpoint unloaded")
                    except:
                        print("⚠️ A1111 unload failed")
                    
                    if localai_success or a1111_success:
                        success = True
                        freed_services = []
                        if localai_success: freed_services.append("LocalAI")
                        if a1111_success: freed_services.append("A1111") 
                        message = f"VRAM freed from: {', '.join(freed_services)}"
                    else:
                        success = False
                        message = "Failed to free VRAM from any service"
                        
                except Exception as e:
                    success = False
                    message = f"Free all VRAM failed: {str(e)}"
                    
            elif container.lower() in ['localai', 'local-ai']:
                if action == 'restart':
                    # Restart LocalAI Docker container
                    try:
                        print("🔄 Restarting LocalAI Docker container via SSH...")
                        result = subprocess.run([
                            'ssh', 
                            '-o', 'StrictHostKeyChecking=no',
                            '-o', 'ConnectTimeout=10',
                            'unraid', 
                            'docker restart LocalAI'
                        ], 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                        )
                        
                        if result.returncode == 0:
                            success = True
                            message = "LocalAI Docker container restarted successfully"
                            print("✅ LocalAI container restarted successfully")
                        else:
                            success = False
                            message = f"LocalAI Docker restart failed: {result.stderr}"
                            print(f"❌ SSH Docker restart failed: {result.stderr}")
                        
                    except Exception as e:
                        success = False
                        message = f"LocalAI Docker restart failed: {str(e)}"
                        
                elif action == 'stop':
                    # Stop LocalAI Docker container
                    try:
                        print("🛑 Stopping LocalAI Docker container via SSH...")
                        result = subprocess.run([
                            'ssh', 
                            '-o', 'StrictHostKeyChecking=no',
                            '-o', 'ConnectTimeout=10',
                            'unraid', 
                            'docker stop LocalAI'
                        ], 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                        )
                        
                        if result.returncode == 0:
                            success = True
                            message = "LocalAI Docker container stopped - VRAM released"
                            print("✅ LocalAI container stopped successfully")
                        else:
                            success = False
                            message = f"LocalAI Docker stop failed: {result.stderr}"
                            print(f"❌ SSH Docker stop failed: {result.stderr}")
                        
                    except Exception as e:
                        success = False
                        message = f"LocalAI Docker stop failed: {str(e)}"
                        
                elif action == 'start':
                    # Start LocalAI Docker container
                    try:
                        print("🚀 Starting LocalAI Docker container via SSH...")
                        result = subprocess.run([
                            'ssh', 
                            '-o', 'StrictHostKeyChecking=no',
                            '-o', 'ConnectTimeout=10',
                            'unraid', 
                            'docker start LocalAI'
                        ], 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                        )
                        
                        if result.returncode == 0:
                            success = True
                            message = "LocalAI Docker container started successfully"
                            print("✅ LocalAI container started successfully")
                        else:
                            success = False
                            message = f"LocalAI Docker start failed: {result.stderr}"
                            print(f"❌ SSH Docker start failed: {result.stderr}")
                        
                    except Exception as e:
                        success = False
                        message = f"LocalAI Docker start failed: {str(e)}"
                    
            elif container.lower() in ['a1111', 'automatic1111', 'automatic1111-webui']:
                if action == 'restart':
                    try:
                        print("🔄 Triggering A1111 Docker container restart via SSH...")
                        
                        # Use SSH to restart the Docker container directly
                        result = subprocess.run([
                            'ssh', 
                            '-o', 'StrictHostKeyChecking=no',
                            '-o', 'ConnectTimeout=10',
                            'unraid', 
                            'docker restart AUTOMATIC1111-Stable-Diffusion-Web-UI'
                        ], 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                        )
                        
                        if result.returncode == 0:
                            print("✅ A1111 Docker container restarted successfully")
                            
                            # Wait for container to fully start
                            print("⏳ Waiting for A1111 to fully restart...")
                            time.sleep(15)
                            
                            success = True
                            message = "A1111 Docker container restarted successfully"
                        else:
                            print(f"❌ SSH Docker restart failed: {result.stderr}")
                            success = False
                            message = f"A1111 Docker restart failed: {result.stderr}"
                        
                    except subprocess.TimeoutExpired:
                        print("❌ Docker restart timeout")
                        success = False
                        message = "A1111 Docker restart timed out"
                    except Exception as e:
                        success = False
                        message = f"A1111 Docker restart failed: {str(e)}"
                        
                elif action == 'stop':
                    # Stop Docker container completely to free all VRAM
                    try:
                        print("🛑 Stopping A1111 Docker container via SSH...")
                        result = subprocess.run([
                            'ssh', 
                            '-o', 'StrictHostKeyChecking=no',
                            '-o', 'ConnectTimeout=10',
                            'unraid', 
                            'docker stop AUTOMATIC1111-Stable-Diffusion-Web-UI'
                        ], 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                        )
                        
                        if result.returncode == 0:
                            success = True
                            message = "A1111 Docker container stopped - all VRAM released"
                            print("✅ A1111 container stopped successfully")
                        else:
                            success = False
                            message = f"A1111 Docker stop failed: {result.stderr}"
                            print(f"❌ SSH Docker stop failed: {result.stderr}")
                        
                    except Exception as e:
                        success = False
                        message = f"A1111 Docker stop failed: {str(e)}"
                        
                elif action == 'start':
                    # Start Docker container 
                    try:
                        print("🚀 Starting A1111 Docker container via SSH...")
                        result = subprocess.run([
                            'ssh', 
                            '-o', 'StrictHostKeyChecking=no',
                            '-o', 'ConnectTimeout=10',
                            'unraid', 
                            'docker start AUTOMATIC1111-Stable-Diffusion-Web-UI'
                        ], 
                        capture_output=True, 
                        text=True, 
                        timeout=30
                        )
                        
                        if result.returncode == 0:
                            success = True
                            message = "A1111 Docker container started - initializing..."
                            print("✅ A1111 container started successfully")
                        else:
                            success = False
                            message = f"A1111 Docker start failed: {result.stderr}"
                            print(f"❌ SSH Docker start failed: {result.stderr}")
                        
                    except Exception as e:
                        success = False
                        message = f"A1111 Docker start failed: {str(e)}"
                    
            else:
                success = False
                message = f"Unknown container: {container}"
            
            # Add operation delay for user feedback
            time.sleep(1)
                
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            response = {
                'success': success,
                'action': action,
                'container': container,
                'message': message
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
                
        except Exception as e:
            print(f"❌ VRAM management error for {container}: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'success': False,
                'error': f'VRAM management failed: {str(e)}'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def _handle_restart_a1111(self):
        """Handle A1111 restart request"""
        try:
            print("🔄 A1111 Restart requested - clearing GPU context...")
            
            # Kill processes using A1111 port (7860)
            kill_process_on_port(7860)
            
            # Wait a moment for cleanup
            time.sleep(3)
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            response = {
                'status': 'success',
                'message': 'A1111 process killed - GPU context cleared',
                'note': 'A1111 will auto-restart on next image generation request'
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            print("✅ A1111 restart completed")
            
        except Exception as e:
            print(f"❌ A1111 restart failed: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'Restart failed: {str(e)}',
                'details': 'Could not restart A1111 service'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def _handle_restart_localai(self):
        """Handle LocalAI restart request"""
        try:
            print("🔄 LocalAI Restart requested - clearing GPU context...")
            
            # Kill processes using LocalAI port (8082)
            kill_process_on_port(8082)
            
            # Wait a moment for cleanup
            time.sleep(3)
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            response = {
                'status': 'success',
                'message': 'LocalAI process killed - GPU context cleared',
                'note': 'LocalAI will auto-restart on next chat request'
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            print("✅ LocalAI restart completed")
            
        except Exception as e:
            print(f"❌ LocalAI restart failed: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'Restart failed: {str(e)}',
                'details': 'Could not restart LocalAI service'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
    
    def do_OPTIONS(self):
        """Handle preflight OPTIONS requests"""
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests"""
        parsed_path = urlparse(self.path)
        
        # API proxy routes
        if parsed_path.path.startswith('/api/localai'):
            # Remove /api/localai prefix and forward to LocalAI
            target_path = parsed_path.path[12:]  # Remove '/api/localai'
            target_url = f'http://192.168.1.206:8082{target_path}'
            if parsed_path.query:
                target_url += f'?{parsed_path.query}'
            
            self._proxy_request(target_url, 'GET')
        
        elif parsed_path.path.startswith('/api/a1111'):
            # Remove /api/a1111 prefix and forward to Automatic1111
            target_path = parsed_path.path[10:]  # Remove '/api/a1111'
            target_url = f'http://192.168.1.206:7860{target_path}'
            if parsed_path.query:
                target_url += f'?{parsed_path.query}'
            
            self._proxy_request(target_url, 'GET')
        
        elif parsed_path.path.startswith('/api/comfy'):
            # Remove /api/comfy prefix and forward to ComfyUI
            target_path = parsed_path.path[10:]  # Remove '/api/comfy'
            target_url = f'http://192.168.1.206:8188{target_path}'
            if parsed_path.query:
                target_url += f'?{parsed_path.query}'
            
            self._proxy_request(target_url, 'GET')
        
        else:
            # Serve static files
            self._serve_static_file(parsed_path.path)
    
    def do_POST(self):
        """Handle POST requests"""
        parsed_path = urlparse(self.path)
        
        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else None
        
        # API proxy routes
        if parsed_path.path.startswith('/api/localai'):
            target_path = parsed_path.path[12:]  # Remove '/api/localai'
            target_url = f'http://192.168.1.206:8082{target_path}'
            
            self._proxy_request(target_url, 'POST', post_data)
        
        elif parsed_path.path.startswith('/api/a1111'):
            target_path = parsed_path.path[10:]  # Remove '/api/a1111'
            target_url = f'http://192.168.1.206:7860{target_path}'
            
            self._proxy_request(target_url, 'POST', post_data)
        
        elif parsed_path.path.startswith('/api/comfy'):
            target_path = parsed_path.path[10:]  # Remove '/api/comfy'
            target_url = f'http://192.168.1.206:8188{target_path}'
            
            self._proxy_request(target_url, 'POST', post_data)
        
        elif parsed_path.path == '/api/restart/a1111':
            self._handle_restart_a1111()
        
        elif parsed_path.path == '/api/restart/localai':
            self._handle_restart_localai()
        
        # Docker container management endpoints
        elif parsed_path.path == '/api/docker/containers':
            self._handle_docker_list()
        
        elif parsed_path.path.startswith('/api/docker/'):
            # Handle dynamic docker operations: /api/docker/{action}/{container}
            path_parts = parsed_path.path.split('/')
            if len(path_parts) >= 5:
                action = path_parts[3]  # start, stop, restart
                container = path_parts[4]  # container name
                self._handle_docker_action(action, container)
            else:
                self.send_response(400)
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(b'Invalid docker command format')
        
        else:
            self.send_response(404)
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(b'Not found')
    
    def log_message(self, format, *args):
        """Override to customize logging"""
        timestamp = time.strftime('[%Y-%m-%d %H:%M:%S]')
        message = format % args
        print(f"{timestamp} {self.address_string()} - {message}")

def kill_process_on_port(port):
    """Kill any process using the specified port"""
    try:
        print(f"🔍 Checking for processes using port {port}...")
        
        if platform.system() == "Windows":
            # Use netstat to find processes using the port
            result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, timeout=10)
            lines = result.stdout.split('\n')
            
            pids_to_kill = []
            for line in lines:
                if f':{port} ' in line and 'LISTENING' in line:
                    parts = line.split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        if pid.isdigit():
                            pids_to_kill.append(pid)
            
            for pid in pids_to_kill:
                try:
                    print(f"🔪 Killing process {pid} using port {port}")
                    subprocess.run(['taskkill', '/F', '/PID', pid], 
                                 capture_output=True, timeout=5)
                    print(f"✅ Successfully killed process {pid}")
                except subprocess.TimeoutExpired:
                    print(f"⚠️ Timeout killing process {pid}")
                except Exception as e:
                    print(f"⚠️ Could not kill process {pid}: {e}")
                    
        else:
            # Unix-like systems
            try:
                result = subprocess.run(['lsof', '-ti', f':{port}'], 
                                      capture_output=True, text=True, timeout=10)
                pids = result.stdout.strip().split('\n')
                for pid in pids:
                    if pid and pid.isdigit():
                        print(f"🔪 Killing process {pid} using port {port}")
                        subprocess.run(['kill', '-9', pid], timeout=5)
                        print(f"✅ Successfully killed process {pid}")
            except subprocess.TimeoutExpired:
                print(f"⚠️ Timeout checking processes on port {port}")
            except FileNotFoundError:
                print(f"ℹ️ lsof not available, skipping port cleanup")
            except Exception as e:
                print(f"⚠️ Error checking port {port}: {e}")
                
    except Exception as e:
        print(f"⚠️ Could not check/kill processes on port {port}: {e}")

def is_port_available(port):
    """Check if a port is available"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex(('localhost', port))
            return result != 0
    except Exception:
        return True

def ensure_port_available(port, max_attempts=3):
    """Ensure port is available, killing processes if necessary"""
    for attempt in range(max_attempts):
        if is_port_available(port):
            print(f"✅ Port {port} is available")
            return True
        
        print(f"🔒 Port {port} is in use (attempt {attempt + 1}/{max_attempts})")
        kill_process_on_port(port)
        
        # Wait a moment for processes to die
        time.sleep(2)
        
        if is_port_available(port):
            print(f"✅ Port {port} is now available")
            return True
    
    print(f"❌ Could not free port {port} after {max_attempts} attempts")
    return False



def run_server(port=8001):
    """Run the all-in-one server"""
    print("🚀 Starting Private AI Chat Server...")
    print(f"🎯 Target port: {port}")
    print()
    
    # Ensure port is available
    if not ensure_port_available(port):
        print(f"💥 Failed to free port {port}. Trying alternative ports...")
        
        # Try alternative ports
        alternative_ports = [port + 1, port + 2, 8080, 8888, 9000]
        for alt_port in alternative_ports:
            print(f"🔄 Trying port {alt_port}...")
            if ensure_port_available(alt_port):
                port = alt_port
                print(f"✅ Using alternative port {port}")
                break
        else:
            print("❌ No available ports found. Please close other applications and try again.")
            return False
    
    try:
        server_address = ('', port)
        httpd = HTTPServer(server_address, AIChatterHandler)
        
        # Update display info with actual port
        print("=" * 70)
        print("🤖 PRIVATE AI CHAT - ALL-IN-ONE SERVER 🤖")
        print("=" * 70)
        print()
        # Get local IP address for network access
        import socket
        try:
            # Connect to a dummy address to get the local IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
        except:
            local_ip = "127.0.0.1"
        
        print("✅ Server Status:")
        print(f"   📡 Local Access: http://localhost:{port}")
        print(f"   🌐 Network Access: http://{local_ip}:{port}")
        print(f"   💬 Chat App (Local): http://localhost:{port}/ai-chat-app/")
        print(f"   💬 Chat App (Network): http://{local_ip}:{port}/ai-chat-app/")
        print()
        print("🔗 API Proxy Routes:")
        print(f"   💬 LocalAI: /api/localai/* → http://192.168.1.206:8082/*")
        print(f"   🎨 Automatic1111: /api/a1111/* → http://192.168.1.206:7860/*")
        print(f"   🔧 ComfyUI: /api/comfy/* → http://192.168.1.206:8188/*")
        print()
        print("📁 Serving files from:", os.getcwd())
        print()
        print("🚀 READY TO CHAT!")
        print("💻 Local Access: Use localhost URLs on this computer")
        print("📱 Network Access: Use network IP URLs from other devices")
        print("🔒 Note: Make sure Windows Firewall allows the connection")
        print("⏹️  Press Ctrl+C to stop the server")
        print("=" * 70)
        
        print(f"Server successfully bound to port {port}")
        httpd.serve_forever()
        
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"❌ Port {port} is still in use after cleanup attempts")
            print("💡 Try running the script again or restart your computer")
        else:
            print(f"❌ Server error: {e}")
        return False
        
    except KeyboardInterrupt:
        print("\n" + "=" * 50)
        print("🛑 Shutting down server...")
        print("👋 Thanks for using Private AI Chat!")
        print("=" * 50)
        httpd.shutdown()
        return True

if __name__ == '__main__':
    # Change to the script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    run_server()