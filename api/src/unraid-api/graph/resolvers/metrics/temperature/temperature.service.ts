// temperature.service.ts - Use plugin-bundled binaries
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

export class TemperatureService implements OnModuleInit {
    private readonly binPath: string;
    private availableTools: Map<string, string> = new Map();

    constructor(private readonly configService: ConfigService) {
        // Use binaries bundled with the plugin
        this.binPath = this.configService.get(
            'API_MONITORING_BIN_PATH',
            '/usr/local/emhttp/plugins/unraid-api/monitoring'
        );
    }

    async onModuleInit() {
        // Use bundled binaries instead of system tools
        await this.initializeBundledTools();

        // Initialize sensor detection for available tools
        if (this.availableTools.has('sensors')) {
            await this.initializeLmSensors();
        }

        if (this.availableTools.has('smartctl')) {
            // Already available through DisksService
        }

        if (this.availableTools.has('nvidia-smi')) {
            await this.initializeNvidiaMonitoring();
        }
    }

    private async initializeBundledTools(): Promise<void> {
        const tools = [
            'sensors', // lm-sensors
            'smartctl', // smartmontools
            'nvidia-smi', // NVIDIA driver
            'ipmitool', // IPMI tools
        ];

        for (const tool of tools) {
            const toolPath = join(this.binPath, tool);
            try {
                await execa(toolPath, ['--version']);
                this.availableTools.set(tool, toolPath);
                this.logger.log(`Temperature tool available: ${tool} at ${toolPath}`);
            } catch {
                this.logger.warn(`Temperature tool not found: ${tool}`);
            }
        }
    }

    // Use bundled binary paths for all executions
    private async execTool(toolName: string, args: string[]): Promise<string> {
        const toolPath = this.availableTools.get(toolName);
        if (!toolPath) {
            throw new Error(`Tool ${toolName} not available`);
        }
        const { stdout } = await execa(toolPath, args);
        return stdout;
    }
}
