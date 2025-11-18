const { Client } = require('ssh2');
const config = require('./config');

class DockerManager {
    constructor() {
        this.sshClient = null;
        this.containerStates = new Map();
        this.startupPromises = new Map();
    }

    // Establish SSH connection
    async connect() {
        return new Promise((resolve, reject) => {
            if (this.sshClient?.readable) {
                return resolve(this.sshClient);
            }

            this.sshClient = new Client();
            
            this.sshClient.on('ready', () => {
                console.log('SSH connection established for Docker management');
                resolve(this.sshClient);
            });
            
            this.sshClient.on('error', (err) => {
                console.error('SSH connection error:', err.message);
                reject(err);
            });
            
            this.sshClient.on('close', () => {
                console.log('SSH connection closed');
                this.sshClient = null;
            });

            // Connect with SSH configuration
            const sshConfig = {
                host: config.docker.ssh.host,
                port: config.docker.ssh.port,
                username: config.docker.ssh.username,
                connectTimeout: config.docker.ssh.connectTimeout,
                readyTimeout: config.docker.ssh.readyTimeout
            };

            // Debug SSH configuration (without exposing sensitive data)
            console.log('🐳 SSH Config:', {
                host: sshConfig.host,
                port: sshConfig.port,
                username: sshConfig.username,
                hasPassword: !!config.docker.ssh.password,
                hasPrivateKey: !!config.docker.ssh.privateKey,
                hasPrivateKeyPath: !!config.docker.ssh.privateKeyPath,
                passwordValue: config.docker.ssh.password ? `${config.docker.ssh.password.substring(0, 3)}***` : 'undefined'
            });

            // Try authentication methods in order: password -> private key content -> private key file
            if (config.docker.ssh.password && config.docker.ssh.password !== 'your_actual_ssh_password_here' && config.docker.ssh.password.trim() !== '') {
                sshConfig.password = config.docker.ssh.password;
                console.log('🔑 Using password authentication');
            } else if (config.docker.ssh.privateKey && config.docker.ssh.privateKey.trim() !== '') {
                sshConfig.privateKey = config.docker.ssh.privateKey;
                console.log('🔑 Using private key content authentication');
            } else if (config.docker.ssh.privateKeyPath && config.docker.ssh.privateKeyPath.trim() !== '') {
                try {
                    const fs = require('fs');
                    const os = require('os');
                    // Expand %USERNAME% in path
                    let keyPath = config.docker.ssh.privateKeyPath.replace('%USERNAME%', os.userInfo().username);
                    sshConfig.privateKey = fs.readFileSync(keyPath, 'utf8');
                    console.log('🔑 Using private key file authentication:', keyPath);
                } catch (keyError) {
                    console.error('❌ Failed to load SSH private key:', keyError.message);
                    return reject(new Error(`Failed to load SSH private key: ${keyError.message}`));
                }
            } else {
                console.error('❌ No valid SSH authentication configured.');
                console.error('Available options: password, privateKey content, or privateKeyPath');
                return reject(new Error('No SSH authentication method configured'));
            }

            // Add debugging
            console.log('🔍 SSH Config being used:', {
                host: sshConfig.host,
                port: sshConfig.port,
                username: sshConfig.username,
                hasPassword: !!sshConfig.password,
                hasPrivateKey: !!sshConfig.privateKey,
                privateKeyLength: sshConfig.privateKey ? sshConfig.privateKey.length : 0
            });
            
            this.sshClient.connect(sshConfig);
        });
    }

    // Execute SSH command
    async executeCommand(command) {
        try {
            await this.connect();
            
            return new Promise((resolve, reject) => {
                this.sshClient.exec(command, (err, stream) => {
                    if (err) return reject(err);
                    
                    let output = '';
                    let error = '';
                    
                    stream.on('data', (data) => {
                        output += data.toString();
                    });
                    
                    stream.stderr.on('data', (data) => {
                        error += data.toString();
                    });
                    
                    stream.on('close', (code) => {
                        if (code === 0) {
                            resolve(output.trim());
                        } else {
                            reject(new Error(`Command failed (${code}): ${error || output}`));
                        }
                    });
                });
            });
        } catch (error) {
            console.error('SSH command execution error:', error.message);
            throw error;
        }
    }

    // Check container status
    async getContainerStatus(containerName) {
        // Check if SSH is configured properly (password OR private key)
        const hasPassword = config.docker.ssh.password && config.docker.ssh.password !== 'your_actual_ssh_password_here' && config.docker.ssh.password.trim() !== '';
        const hasPrivateKey = config.docker.ssh.privateKey && config.docker.ssh.privateKey.trim() !== '';
        const hasPrivateKeyPath = config.docker.ssh.privateKeyPath && config.docker.ssh.privateKeyPath.trim() !== '';
        
        if (!hasPassword && !hasPrivateKey && !hasPrivateKeyPath) {
            console.log(`⚠️ SSH not configured, simulating ${containerName} as stopped`);
            return 'stopped';
        }

        try {
            const command = config.docker.commands.status.replace('{container}', containerName);
            const output = await this.executeCommand(command);
            
            if (output.includes('Up')) {
                return 'running';
            } else if (output.includes('Exited')) {
                return 'stopped';
            } else {
                return 'unknown';
            }
        } catch (error) {
            console.error(`Failed to get status for ${containerName}:`, error.message);
            return 'error';
        }
    }

    // Start container
    async startContainer(containerName) {
        // Check if SSH is configured properly (password OR private key)
        const hasPassword = config.docker.ssh.password && config.docker.ssh.password !== 'your_actual_ssh_password_here' && config.docker.ssh.password.trim() !== '';
        const hasPrivateKey = config.docker.ssh.privateKey && config.docker.ssh.privateKey.trim() !== '';
        const hasPrivateKeyPath = config.docker.ssh.privateKeyPath && config.docker.ssh.privateKeyPath.trim() !== '';
        
        if (!hasPassword && !hasPrivateKey && !hasPrivateKeyPath) {
            console.log(`⚠️ SSH not configured, simulating start of ${containerName}`);
            this.containerStates.set(containerName, 'running');
            return true;
        }

        try {
            const status = await this.getContainerStatus(containerName);
            if (status === 'running') {
                console.log(`Container ${containerName} is already running`);
                return true;
            }

            console.log(`Starting container: ${containerName}`);
            const command = config.docker.commands.start.replace('{container}', containerName);
            await this.executeCommand(command);
            
            // Wait for startup time if configured
            const containerConfig = config.docker.containers[containerName];
            if (containerConfig?.startupTime) {
                console.log(`Waiting ${containerConfig.startupTime}ms for ${containerName} to start up...`);
                await new Promise(resolve => setTimeout(resolve, containerConfig.startupTime));
            }
            
            // Verify it's running
            const newStatus = await this.getContainerStatus(containerName);
            const success = newStatus === 'running';
            
            if (success) {
                this.containerStates.set(containerName, 'running');
                console.log(`Container ${containerName} started successfully`);
            } else {
                console.error(`Container ${containerName} failed to start (status: ${newStatus})`);
            }
            
            return success;
        } catch (error) {
            console.error(`Failed to start container ${containerName}:`, error.message);
            return false;
        }
    }

    // Stop container
    async stopContainer(containerName) {
        // Check if SSH is configured properly (password OR private key)
        const hasPassword = config.docker.ssh.password && config.docker.ssh.password !== 'your_actual_ssh_password_here' && config.docker.ssh.password.trim() !== '';
        const hasPrivateKey = config.docker.ssh.privateKey && config.docker.ssh.privateKey.trim() !== '';
        const hasPrivateKeyPath = config.docker.ssh.privateKeyPath && config.docker.ssh.privateKeyPath.trim() !== '';
        
        if (!hasPassword && !hasPrivateKey && !hasPrivateKeyPath) {
            console.log(`⚠️ SSH not configured, simulating stop of ${containerName}`);
            this.containerStates.set(containerName, 'stopped');
            return true;
        }

        try {
            const status = await this.getContainerStatus(containerName);
            if (status === 'stopped') {
                console.log(`Container ${containerName} is already stopped`);
                return true;
            }

            console.log(`Stopping container: ${containerName}`);
            const command = config.docker.commands.stop.replace('{container}', containerName);
            await this.executeCommand(command);
            
            // Verify it's stopped
            const newStatus = await this.getContainerStatus(containerName);
            const success = newStatus === 'stopped';
            
            if (success) {
                this.containerStates.set(containerName, 'stopped');
                console.log(`Container ${containerName} stopped successfully`);
            } else {
                console.error(`Container ${containerName} failed to stop (status: ${newStatus})`);
            }
            
            return success;
        } catch (error) {
            console.error(`Failed to stop container ${containerName}:`, error.message);
            return false;
        }
    }

    // Ensure container is running (for auto-managed containers)
    async ensureContainerRunning(containerKey) {
        const containerConfig = config.docker.containers[containerKey];
        if (!containerConfig?.autoManage) {
            return true; // Don't manage containers that aren't auto-managed
        }

        // Get the actual container name from config
        const actualContainerName = containerConfig.name;
        console.log(`🔍 Ensuring container is running: ${containerKey} -> ${actualContainerName}`);

        // Check if we're already starting this container
        if (this.startupPromises.has(containerKey)) {
            console.log(`Container ${containerKey} startup already in progress, waiting...`);
            return await this.startupPromises.get(containerKey);
        }

        const status = await this.getContainerStatus(actualContainerName);
        if (status === 'running') {
            return true;
        }

        // Start the container using the actual name
        const startupPromise = this.startContainer(actualContainerName);
        this.startupPromises.set(containerKey, startupPromise);
        
        try {
            const result = await startupPromise;
            this.startupPromises.delete(containerKey);
            return result;
        } catch (error) {
            this.startupPromises.delete(containerKey);
            throw error;
        }
    }

    // Health check for service
    async healthCheck(serviceName) {
        try {
            const containerConfig = config.docker.containers[serviceName];
            if (!containerConfig?.healthCheck) {
                return true; // No health check configured
            }

            const serviceConfig = config.ai[serviceName];
            if (!serviceConfig?.url) {
                return false;
            }

            const healthUrl = `${serviceConfig.url}${containerConfig.healthCheck}`;
            const response = await fetch(healthUrl, {
                method: 'GET',
                timeout: 5000
            });

            return response.ok;
        } catch (error) {
            console.log(`Health check failed for ${serviceName}: ${error.message}`);
            return false;
        }
    }

    // Get all container statuses
    async getAllContainerStatuses() {
        const statuses = {};
        
        for (const [name, containerConfig] of Object.entries(config.docker.containers)) {
            try {
                statuses[name] = {
                    status: await this.getContainerStatus(name),
                    autoManage: containerConfig.autoManage,
                    displayName: containerConfig.displayName,
                    description: containerConfig.description
                };
            } catch (error) {
                statuses[name] = {
                    status: 'error',
                    error: error.message,
                    autoManage: containerConfig.autoManage,
                    displayName: containerConfig.displayName,
                    description: containerConfig.description
                };
            }
        }
        
        return statuses;
    }

    // Cleanup - stop auto-managed containers
    async cleanup() {
        console.log('Cleaning up Docker containers...');
        
        for (const [name, containerConfig] of Object.entries(config.docker.containers)) {
            if (containerConfig.autoManage) {
                try {
                    await this.stopContainer(name);
                } catch (error) {
                    console.error(`Failed to stop ${name} during cleanup:`, error.message);
                }
            }
        }

        if (this.sshClient?.readable) {
            this.sshClient.end();
        }
    }

    // Disconnect SSH
    disconnect() {
        if (this.sshClient?.readable) {
            this.sshClient.end();
            this.sshClient = null;
        }
    }
}

// Create singleton instance
const dockerManager = new DockerManager();

// Cleanup on process exit
process.on('SIGINT', async () => {
    await dockerManager.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await dockerManager.cleanup();
    process.exit(0);
});

module.exports = dockerManager;