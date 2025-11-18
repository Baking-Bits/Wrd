# VRAM Management System Documentation

## Overview
This AI chat application implements a sophisticated Docker-based VRAM management system that automatically handles container start/stop operations to prevent memory conflicts between LocalAI (LLM) and Automatic1111 (image generation) services.

## Architecture

### Core Components
- **LocalAI Container**: Handles chat/text generation
- **Automatic1111 Container**: Handles image generation  
- **SSH Docker Management**: Remote container control via SSH
- **Smart Auto-Switching**: Automatic service selection based on request type
- **Manual Override Controls**: Docker buttons for direct container management

### Container Names
- **LocalAI**: `LocalAI`
- **Automatic1111**: `AUTOMATIC1111-Stable-Diffusion-Web-UI`

## VRAM Management Strategies

### 1. Automatic Smart Management

#### Chat Requests (LocalAI)
**Trigger**: Any non-image text message
**Process**:
1. 🛑 Stop A1111 container completely via SSH
2. 💾 All A1111 VRAM immediately released
3. ⏳ Wait 2 seconds for container shutdown
4. 💬 LocalAI gets full VRAM access
5. 🔄 LocalAI uses `keep_alive: 0` for immediate memory release after response

**Implementation**: `sendToLocalAI()` function
```javascript
// Stop A1111 container completely to free all VRAM
const stopResponse = await fetch('/api/docker/stop/a1111', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
});
```

#### Image Requests (A1111)
**Trigger**: Messages starting with `/image `
**Process**:
1. 🚀 Start A1111 container via SSH (if stopped)
2. ⏳ Wait 15 seconds for full container initialization
3. 🔧 Load default checkpoint if needed
4. 🎨 Generate image with full VRAM access

**Implementation**: `generateImage()` function
```javascript
// Start A1111 container (will do nothing if already running)
const startResponse = await fetch('/api/docker/start/a1111', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
});
```

### 2. Error Recovery System

#### Tensor Device Mismatch Auto-Recovery
**Problem**: Mixed CPU/GPU tensors causing crashes
**Solution**: Automated Docker restart with retry
**Process**:
1. 🔍 Detect tensor device mismatch error
2. 🔧 SSH restart A1111 container automatically
3. ⏳ Wait 25 seconds for full restart + initialization
4. 📋 Load checkpoint explicitly via API
5. 🔄 Automatically retry the same image generation
6. ✅ Seamless recovery without user intervention

**Implementation**: Error detection in `generateImage()`
```javascript
if (errorText.includes('Expected all tensors to be on the same device')) {
    // Automatic SSH Docker restart
    const dockerResponse = await fetch('/api/docker/restart/a1111', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    // ... wait and retry logic
}
```

### 3. Manual Docker Controls

#### Docker Button Actions
**Location**: Top-right Docker menu (🐳 icon)

**LocalAI Controls**:
- 💤 **Start**: `docker start LocalAI` via SSH
- 🔥 **Stop**: `docker stop LocalAI` via SSH  
- 🔄 **Restart**: `docker restart LocalAI` via SSH

**A1111 Controls**:
- 💤 **Start**: `docker start AUTOMATIC1111-Stable-Diffusion-Web-UI` via SSH
- 🔥 **Stop**: `docker stop AUTOMATIC1111-Stable-Diffusion-Web-UI` via SSH
- 🔄 **Restart**: `docker restart AUTOMATIC1111-Stable-Diffusion-Web-UI` via SSH

**Quick Actions**:
- 🆓 **Free All VRAM**: Stops both containers simultaneously

**Implementation**: `handleDockerAction()` function
```javascript
const response = await fetch(`/api/docker/${action}/${container}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
});
```

## Backend SSH Implementation

### Docker Commands
**Location**: `run_chat.py` - `_handle_docker_action()` function

#### A1111 Container Management
```python
# Stop A1111
subprocess.run([
    'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
    'unraid', 'docker stop AUTOMATIC1111-Stable-Diffusion-Web-UI'
])

# Start A1111  
subprocess.run([
    'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
    'unraid', 'docker start AUTOMATIC1111-Stable-Diffusion-Web-UI'
])

# Restart A1111
subprocess.run([
    'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', 
    'unraid', 'docker restart AUTOMATIC1111-Stable-Diffusion-Web-UI'
])
```

#### LocalAI Container Management  
```python
# Stop LocalAI
subprocess.run([
    'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
    'unraid', 'docker stop LocalAI'
])

# Start LocalAI
subprocess.run([
    'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
    'unraid', 'docker start LocalAI'
])
```

### SSH Configuration
**Requirements**:
- SSH key authentication set up to Unraid server
- SSH config file with `unraid` host alias
- Passwordless access for automation

**SSH Config** (`~/.ssh/config`):
```
Host unraid
    HostName 192.168.1.206
    User root
    IdentityFile ~/.ssh/unraid_auto
    StrictHostKeyChecking no
    ConnectTimeout 10
```

## API Endpoints

### Docker Management Routes
- `POST /api/docker/start/{container}` - Start container
- `POST /api/docker/stop/{container}` - Stop container  
- `POST /api/docker/restart/{container}` - Restart container

### Container Names
- `localai` → `LocalAI` Docker container
- `a1111` → `AUTOMATIC1111-Stable-Diffusion-Web-UI` Docker container
- `all` → Special case: stops both containers

## Benefits of This System

### Zero VRAM Conflicts
- ✅ **Complete isolation**: Only one service uses VRAM at a time
- ✅ **True memory release**: Container stop frees ALL memory, not just models
- ✅ **No checkpoint complexity**: Clean container-level management
- ✅ **Predictable behavior**: Eliminates memory allocation guesswork

### Smart Automation
- ✅ **Context awareness**: Automatically switches based on request type
- ✅ **Seamless UX**: User just types, system handles everything
- ✅ **Error recovery**: Automatic fixes for common GPU issues
- ✅ **Manual override**: Direct control when needed

### Resource Optimization  
- ✅ **Maximum performance**: Each service gets full VRAM when active
- ✅ **Zero waste**: No idle memory consumption
- ✅ **Fast switching**: Containers start/stop in seconds
- ✅ **Reliable**: SSH-based control is robust and tested

## Image Generation Configuration

### Format Settings
- **Resolution**: 576×768 (portrait/phone format)
- **Aspect Ratio**: 3:4 (optimized for mobile viewing)
- **Sampler**: Euler a
- **CFG Scale**: 7
- **Steps**: 10 (fast generation)

### Model Configuration
- **Default Checkpoint**: `uberRealisticPornMergePonyxl_ponyxlHybridV1.safetensors`
- **Auto-loading**: Checkpoint loads automatically on container start
- **Recovery**: Explicit checkpoint loading after restart/recovery

## Troubleshooting

### Common Issues

#### SSH Connection Failures
- **Symptom**: Docker actions fail with SSH errors
- **Solution**: Check SSH key authentication, network connectivity
- **Test**: `ssh unraid "docker ps"` should work without password

#### Container Start Delays
- **Symptom**: Service unavailable after start command  
- **Solution**: Wait times are built-in (15s for A1111, 2s for LocalAI)
- **Cause**: Containers need time to fully initialize

#### Tensor Device Mismatches
- **Symptom**: "Expected all tensors to be on the same device" errors
- **Solution**: System auto-recovers with Docker restart + retry
- **Manual**: Use Docker restart button if auto-recovery fails

### Monitoring

#### Container Status
- Use Docker SSH utility: `python docker_ssh.py list`
- Check via SSH: `ssh unraid "docker ps"`
- UI indicators: VRAM status display shows current state

#### Memory Usage
- **LocalAI**: Monitor via container logs and response times
- **A1111**: Check GPU utilization during image generation
- **System**: Watch for OOM errors in container logs

## Future Enhancements

### Potential Improvements
1. **Container health monitoring**: Automatic health checks and recovery
2. **Resource usage tracking**: Memory and GPU utilization metrics  
3. **Advanced scheduling**: Queue management for concurrent requests
4. **Custom configurations**: User-selectable image formats and models
5. **Performance optimization**: Faster container startup with pre-warming

### Scalability Options
1. **Multi-GPU support**: Dedicated GPUs for each service
2. **Container orchestration**: Kubernetes-based management
3. **Load balancing**: Multiple instances with request distribution
4. **Caching layers**: Model caching for faster switching

---

**Last Updated**: November 14, 2025
**Version**: 2.0 - Docker Container Management System