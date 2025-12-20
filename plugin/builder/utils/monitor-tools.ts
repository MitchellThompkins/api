// Enhancement to the plugin build process
// Location: plugin/builder/build-txz.ts

// Add function to download monitoring tools during build
const downloadMonitoringTools = async (targetDir: string) => {
  console.log("Downloading temperature monitoring tools from safe sources...");
  
  const tools = [
    {
      name: 'sensors',
      url: 'https://github.com/lm-sensors/lm-sensors/releases/download/v3.6.0/sensors-3.6.0-x86_64',
      sha256: 'abc123...', // Verify integrity
    },
    {
      name: 'smartctl', 
      url: 'https://sourceforge.net/projects/smartmontools/files/smartmontools/7.4/smartctl-7.4-x86_64',
      sha256: 'def456...', // Verify integrity
    },
    {
      name: 'nvidia-smi',
      url: 'https://developer.nvidia.com/downloads/nvidia-smi-545.29.06-x86_64',
      sha256: 'ghi789...', // Verify integrity
    }
  ];

  const monitoringDir = join(targetDir, 'usr/local/emhttp/plugins/unraid-api/monitoring');
  await fs.mkdir(monitoringDir, { recursive: true });

  for (const tool of tools) {
    console.log(`Downloading ${tool.name}...`);
    const response = await fetch(tool.url);
    const buffer = await response.arrayBuffer();
    
    // Verify SHA256 checksum
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(buffer));
    if (hash.digest('hex') !== tool.sha256) {
      throw new Error(`Checksum verification failed for ${tool.name}`);
    }
    
    // Save binary
    const toolPath = join(monitoringDir, tool.name);
    await fs.writeFile(toolPath, Buffer.from(buffer));
    await fs.chmod(toolPath, 0o755);
    
    console.log(`✓ ${tool.name} downloaded and verified`);
  }
};
