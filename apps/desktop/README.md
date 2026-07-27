# OpenClaw Desktop App

A desktop application for managing OpenClaw agents and configurations.

## Features

### Channel Management

The desktop app provides intuitive channel management functionality for connecting OpenClaw to various messaging platforms:

#### Supported Channels
- **WhatsApp**: Connect via QR code scanning
- **Telegram**: Connect by creating a bot with @BotFather
- **Discord**: Connect by setting up a bot through the developer portal
- **Slack**: Coming soon

#### Channel Connection Features

##### Connect to Channels
1. Navigate to **Channels** → **Add New Channel**
2. Select the desired platform (WhatsApp, Telegram, Discord)
3. Click **Setup** to begin the connection process
4. Follow the platform-specific setup instructions:
   - **WhatsApp**: Scan the QR code with your phone
   - **Telegram**: Enter your bot token from @BotFather
   - **Discord**: Enter bot token and server ID

##### Loading States and User Feedback
- **Setup Button Spinner**: Shows loading animation when starting channel setup
- **Connect Button Spinner**: Displays loading state during connection attempts in setup modals
- **Disconnect Button Spinner**: Indicates disconnection in progress
- **Real-time Status Updates**: Channels automatically update their connection status
- **Button Disable States**: Prevents multiple simultaneous operations

##### Disconnect from Channels
1. Navigate to **Channels** → **Add New Channel**
2. Find the connected channel (marked with ✅ Connected)
3. Click **Disconnect** to safely remove the channel connection
4. Confirmation and loading feedback provided throughout the process

##### Technical Implementation
- **Backend Integration**: Uses OpenClaw CLI for channel operations (`channels login`, `channels logout`)
- **IPC Communication**: Secure communication between UI and backend processes
- **State Management**: React hooks manage connection states and loading indicators
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Process Management**: Proper timeout handling and process cleanup

#### Channel Status Indicators
- **Connected**: Green checkmark with "Connected" text
- **Disconnected**: Setup button available for connection
- **Coming Soon**: Grayed out for unsupported channels
- **Real-time Updates**: Dynamic status changes without page refresh

### Agent Management

The desktop app provides a user-friendly interface for creating and managing OpenClaw agents with the following capabilities:

#### Model Configuration
- **Primary Model Selection**: Choose the main AI model for your agent
- **Model Fallback Configuration**: Configure backup models that will be used if the primary model fails

#### Agent Lifecycle Management
- **Agent Creation**: Create new agents with custom configurations
- **Agent Configuration**: Modify existing agent settings and models
- **Agent Deletion**: Safely delete agents with confirmation protection

#### Model Fallback Feature

The model fallback system provides robust failover capabilities for your OpenClaw agents:

1. **Primary Model**: The main AI model used for agent interactions
2. **Fallback Models**: A list of backup models that will be tried in sequence if the primary model becomes unavailable

##### How to Configure Model Fallbacks:

1. Navigate to **AI Configuration** → **Agents**
2. Click **Create New Agent**
3. Fill in the basic agent details (name, primary model)
4. Click **Configure Fallback Models** to expand the fallback configuration section
5. Add fallback models by:
   - Typing the model name/ID in the input field
   - Clicking **Add Fallback** to add it to the list
   - Repeat for multiple fallback models
6. Remove fallback models by clicking the **×** button next to any model
7. Click **Create Agent** to save the configuration

##### Fallback Behavior:

When an agent encounters a model failure:
- The system will automatically try each fallback model in the order they were configured
- The first available fallback model will be used to continue the conversation
- This ensures uninterrupted service even when specific models are unavailable

##### Configuration Storage:

Model fallback settings are stored in your OpenClaw configuration file (`~/.openclaw/openclaw.json`) under:
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "your-primary-model",
        "fallbacks": ["fallback-model-1", "fallback-model-2"]
      }
    }
  }
}
```

#### Agent Deletion Feature

The desktop app provides a safe and user-friendly way to delete agents with built-in protection against accidental deletions:

##### How to Delete an Agent:

1. Navigate to **AI Configuration** → **Agents**
2. Find the agent you want to delete in the agent list
3. Click the red **🗑️** delete button on the agent card
4. A confirmation dialog will appear showing:
   - The agent name to be deleted
   - A warning about permanent deletion
   - Cancel and Delete options
5. Click **Delete Agent** to confirm the permanent removal
6. The agent will be deleted and automatically removed from the list

##### Safety Features:

- **Confirmation Dialog**: Prevents accidental deletions with a clear warning message
- **Visual Feedback**: Loading spinner and "Deleting..." text during the deletion process
- **Error Handling**: User-friendly error messages if deletion fails
- **Auto-refresh**: The agent list automatically updates after successful deletion

##### Technical Details:

- Agents are deleted using the OpenClaw CLI `agents delete --force` command
- Deletion is permanent and cannot be undone
- All agent configuration and associated data is permanently removed
- The operation is performed through secure IPC communication between the UI and backend

## Development

### Prerequisites
- Node.js 22+
- pnpm

### Running the App
```bash
pnpm install
pnpm build
pnpm dev
```

### Building for Distribution
```bash
pnpm build
```

The desktop app is built using Electron and Vite for fast development and reliable performance.

## Troubleshooting

### WhatsApp Messages Not Appearing in Desktop App

**Problem**: WhatsApp messages sent from your phone are not showing up in the desktop app's "WhatsApp Messages" section, even though WhatsApp appears to be connected.

**Root Causes**:
1. WhatsApp channel plugin not properly enabled in OpenClaw configuration
2. WhatsApp session not linked - no active WhatsApp Web listener
3. Desktop app only showing internal logs instead of actual OpenClaw gateway logs

**Solution**:

1. **Enable WhatsApp and fix configuration issues**:
   ```bash
   export OPENCLAW_BUNDLED_PLUGINS_DIR="$PWD/extensions"
   export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
   bun src/index.ts doctor --fix
   ```

2. **Start OpenClaw gateway with proper environment**:
   ```bash
   export OPENCLAW_BUNDLED_PLUGINS_DIR="$PWD/extensions"
   export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
   bun src/index.ts gateway run --port 18790 --bind loopback --allow-unconfigured
   ```

3. **Link WhatsApp Web session**:
   ```bash
   export OPENCLAW_BUNDLED_PLUGINS_DIR="$PWD/extensions"
   export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
   bun src/index.ts channels login --channel whatsapp --account default
   ```

4. **Verify WhatsApp is working**:
   ```bash
   export OPENCLAW_BUNDLED_PLUGINS_DIR="$PWD/extensions"
   export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
   bun src/index.ts channels status
   ```

   You should see: `WhatsApp default (WhatsApp): enabled, configured, linked, running, connected`

5. **Test message sending**:
   ```bash
   export OPENCLAW_BUNDLED_PLUGINS_DIR="$PWD/extensions"
   export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
   bun src/index.ts message send --channel whatsapp --target +your-number --message "test"
   ```

**Technical Details**:
- The desktop app's `getLogs()` method has been updated to fetch actual OpenClaw gateway logs via the `openclaw logs` command instead of just internal desktop logs
- WhatsApp message activity is logged by the OpenClaw gateway and needs to be retrieved through the proper log integration
- The desktop app's WhatsApp section parses these gateway logs to display message activity

**Verification**:
After following these steps, WhatsApp messages should appear in the desktop app's "WhatsApp Messages" section within the Channels logs area.