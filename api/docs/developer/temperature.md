# Temperature Monitoring

The Temperature Monitoring feature allows the Unraid API to collect and expose temperature metrics from various sensors (CPU, Disks, Motherboard, etc.).

## Configuration

You can configure the temperature monitoring behavior in your `api.json` (or via environment variables).

### `api.temperature` Object

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | Globally enable or disable temperature monitoring. |
| `default_unit` | `string` | `"celsius"` | The unit to return values in. Options: `"celsius"`, `"fahrenheit"`. |
| `polling_interval` | `number` | `5000` | Polling interval in milliseconds for the subscription. |
| `history_size` | `number` | `100` | (Internal) Number of historical data points to keep in memory per sensor. |

### `api.temperature.sensors` Object

Enable or disable specific sensor providers.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `lm_sensors.enabled` | `boolean` | `true` | Enable `lm-sensors` provider (requires `sensors` binary). |
| `lm_sensors.config_path` | `string` | `null` | Optional path to a specific sensors config file (passed as `-c` to `sensors`). |
| `smartctl.enabled` | `boolean` | `true` | Enable disk temperature monitoring via `smartctl` (via DiskService). |
| `ipmi.enabled` | `boolean` | `true` | Enable IPMI sensor provider (requires `ipmitool`). |

### `api.temperature.thresholds` Object

Customize warning and critical thresholds.

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cpu_warning` | `number` | `70` | Warning threshold for CPU. |
| `cpu_critical` | `number` | `85` | Critical threshold for CPU. |
| `disk_warning` | `number` | `50` | Warning threshold for Disks. |
| `disk_critical` | `number` | `60` | Critical threshold for Disks. |

## GraphQL API

### Query: `metrics` -> `temperature`

Returns a snapshot of the current temperature metrics.

```graphql
query {
  metrics {
    temperature {
      id
      summary {
        average
        hottest {
          name
          current { value unit }
        }
      }
      sensors {
        id
        name
        type
        current {
          value
          unit
          status
        }
        history {
          value
          timestamp
        }
      }
    }
  }
}
```

### Subscription: `systemMetricsTemperature`

Subscribes to temperature updates (pushed at `polling_interval`).

```graphql
subscription {
  systemMetricsTemperature {
    summary {
      average
    }
    sensors {
      name
      current {
        value
      }
    }
  }
}
```
