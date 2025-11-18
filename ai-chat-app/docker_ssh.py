#!/usr/bin/env python3
"""
SSH Docker Management Utility for Unraid Server
Provides easy Docker container management via SSH
"""

import subprocess
import sys
import time
import argparse

def run_ssh_command(command, timeout=30):
    """Run a command via SSH to the Unraid server"""
    try:
        result = subprocess.run([
            'ssh', 
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'ConnectTimeout=10',
            'unraid', 
            command
        ], 
        capture_output=True, 
        text=True, 
        timeout=timeout
        )
        
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", "Command timed out"
    except Exception as e:
        return False, "", str(e)

def list_containers():
    """List all Docker containers"""
    print("🐳 Listing Docker containers...")
    success, stdout, stderr = run_ssh_command('docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"')
    
    if success:
        print("✅ Container list:")
        print(stdout)
    else:
        print(f"❌ Failed to list containers: {stderr}")

def restart_container(container_name):
    """Restart a specific Docker container"""
    print(f"🔄 Restarting Docker container: {container_name}")
    success, stdout, stderr = run_ssh_command(f'docker restart {container_name}', timeout=60)
    
    if success:
        print(f"✅ Container {container_name} restarted successfully")
        
        # Wait and check status
        print("⏳ Waiting for container to start...")
        time.sleep(10)
        
        success, stdout, stderr = run_ssh_command(f'docker ps --format "table {{.Names}}\\t{{.Status}}" | grep {container_name}')
        if success and stdout:
            print(f"📊 Status: {stdout.strip()}")
        
    else:
        print(f"❌ Failed to restart {container_name}: {stderr}")

def stop_container(container_name):
    """Stop a specific Docker container"""
    print(f"🛑 Stopping Docker container: {container_name}")
    success, stdout, stderr = run_ssh_command(f'docker stop {container_name}', timeout=60)
    
    if success:
        print(f"✅ Container {container_name} stopped successfully")
    else:
        print(f"❌ Failed to stop {container_name}: {stderr}")

def start_container(container_name):
    """Start a specific Docker container"""
    print(f"🚀 Starting Docker container: {container_name}")
    success, stdout, stderr = run_ssh_command(f'docker start {container_name}', timeout=60)
    
    if success:
        print(f"✅ Container {container_name} started successfully")
        
        # Wait and check status
        print("⏳ Waiting for container to start...")
        time.sleep(5)
        
        success, stdout, stderr = run_ssh_command(f'docker ps --format "table {{.Names}}\\t{{.Status}}" | grep {container_name}')
        if success and stdout:
            print(f"📊 Status: {stdout.strip()}")
    else:
        print(f"❌ Failed to start {container_name}: {stderr}")

def main():
    parser = argparse.ArgumentParser(description='SSH Docker Management for Unraid')
    parser.add_argument('action', choices=['list', 'restart', 'stop', 'start'], 
                       help='Action to perform')
    parser.add_argument('container', nargs='?', 
                       help='Container name (required for restart, stop, start)')
    
    args = parser.parse_args()
    
    if args.action == 'list':
        list_containers()
    elif args.action in ['restart', 'stop', 'start']:
        if not args.container:
            print("❌ Container name is required for this action")
            sys.exit(1)
            
        if args.action == 'restart':
            restart_container(args.container)
        elif args.action == 'stop':
            stop_container(args.container)
        elif args.action == 'start':
            start_container(args.container)

if __name__ == '__main__':
    main()