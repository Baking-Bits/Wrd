#!/usr/bin/env python3
"""
Simple CORS proxy for LocalAI API calls
This bypasses CORS restrictions by proxying requests server-side
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.request
import urllib.parse
import urllib.error
from urllib.parse import urlparse, parse_qs
import os
import mimetypes

class CORSProxyHandler(BaseHTTPRequestHandler):
    
    def _set_cors_headers(self):
        """Set CORS headers to allow cross-origin requests"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Max-Age', '3600')
    
    def _serve_static_file(self, path):
        """Serve static files from the current directory"""
        if path == '/':
            path = '/index.html'
        
        file_path = '.' + path
        
        if os.path.exists(file_path) and os.path.isfile(file_path):
            mime_type, _ = mimetypes.guess_type(file_path)
            if mime_type is None:
                mime_type = 'application/octet-stream'
            
            self.send_response(200)
            self.send_header('Content-type', mime_type)
            self._set_cors_headers()
            self.end_headers()
            
            with open(file_path, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.send_header('Content-type', 'text/html')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(b'File not found')
    
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
            
            req = urllib.request.Request(target_url, data=data, headers=headers, method=method)
            
            with urllib.request.urlopen(req, timeout=30) as response:
                response_data = response.read()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                
                self.wfile.write(response_data)
                
        except urllib.error.HTTPError as e:
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
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'Connection error: {str(e.reason)}',
                'details': 'Could not connect to LocalAI server'
            }
            self.wfile.write(json.dumps(error_response).encode('utf-8'))
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            
            error_response = {
                'error': f'Proxy error: {str(e)}',
                'details': 'Internal proxy server error'
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
        
        else:
            self.send_response(404)
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(b'Not found')

def run_server(port=8000):
    """Run the CORS proxy server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, CORSProxyHandler)
    print(f"CORS Proxy Server running on http://localhost:{port}")
    print(f"Serving files from: {os.getcwd()}")
    print("API routes available:")
    print("  /api/localai/* -> http://192.168.1.206:8082/*")
    print("  /api/a1111/* -> http://192.168.1.206:7860/*") 
    print("  /api/comfy/* -> http://192.168.1.206:8188/*")
    print("\nPress Ctrl+C to stop the server")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.shutdown()

if __name__ == '__main__':
    run_server()