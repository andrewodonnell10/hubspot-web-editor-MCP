# Quick Start Guide

Get up and running with the HubSpot CMS MCP Server in 5 minutes.

## Step 1: Prerequisites

Ensure you have:
- [x] Node.js 18.0.0 or higher installed
- [x] Access to a HubSpot account with CMS Hub
- [x] Administrator access to create private apps

## Step 2: Create HubSpot Private App

1. Log into your HubSpot account
2. Go to **Settings** (gear icon in top navigation)
3. Navigate to **Integrations** → **Private Apps**
4. Click **"Create a private app"**
5. Fill in basic info:
   - **Name**: "Claude MCP Server"
   - **Description**: "AI-assisted content management via Model Context Protocol"
6. Go to the **Scopes** tab
7. Enable these scopes:
   - ✅ `content` (read and write)
   - ✅ `oauth` (for token validation)
8. Click **"Create app"**
9. Click **"Show token"** and copy it
10. Click **"Continue creating"**

**Important**: Save your token somewhere secure. You'll need it in the next step.

## Step 3: Install and Configure

```bash
# Clone or navigate to the project directory
cd hubspot-cms-mcp-server

# Install dependencies
npm install

# Create .env file with your token
echo "HUBSPOT_ACCESS_TOKEN=your-token-here" > .env

# Build the project
npm run build
```

Replace `your-token-here` with the token you copied from HubSpot.

## Step 4: Test the Server

```bash
# Run the server
npm start
```

If successful, you should see:
```
{"timestamp":"2024-...","level":"info","message":"Starting HubSpot CMS MCP Server","data":{"version":"1.0.0"}}
{"timestamp":"2024-...","level":"info","message":"HubSpot connection validated","data":{"hubId":12345678,"scopes":["content","oauth"]}}
{"timestamp":"2024-...","level":"info","message":"Server started successfully"}
```

Press `Ctrl+C` to stop.

## Step 5: Configure Claude Desktop

1. Find your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Edit the file and add the HubSpot MCP server:

```json
{
  "mcpServers": {
    "hubspot-cms": {
      "command": "node",
      "args": [
        "/FULL/PATH/TO/hubspot-cms-mcp-server/dist/index.js"
      ],
      "env": {
        "HUBSPOT_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

**Important**:
- Replace `/FULL/PATH/TO/` with the actual absolute path to your project
- Replace `your-token-here` with your HubSpot token

3. Restart Claude Desktop

## Step 6: Verify in Claude

Open Claude Desktop and try these commands:

```
Can you authenticate with HubSpot and show me the connection status?
```

Claude should respond with your hub information and rate limit status.

```
Can you list the 5 most recent blog posts?
```

Claude should show a list of your blog posts.

## Next Steps

### Explore the Tools

Try these common tasks:

**View a blog post**:
```
Show me the details of blog post ID 123456789
```

**Update metadata**:
```
Update the meta description of post 123456789 to "Learn about wellness practice management"
```

**Publish a draft** (⚠️ this makes content live):
```
Publish the draft for post 123456789
```

### Learn More

- Read the [full README](README.md) for detailed documentation
- Review [Security Best Practices](SECURITY.md)
- Check the [API documentation](https://developers.hubspot.com/docs/api/cms/blog-post)

### Common Use Cases for Core Wrk

**Blog Series Management**:
```
List all blog posts with "billing" in the title, then add the tag ID 42 to all of them
```

**SEO Optimization**:
```
Get post 123456789, then update its meta description and HTML title for better SEO
```

**Content Consistency**:
```
List all posts by author "Jane Doe" and check if they all have featured images
```

## Troubleshooting

### "Authentication failed"

**Problem**: Token is invalid or expired

**Solution**:
1. Go to HubSpot → Settings → Integrations → Private Apps
2. Verify your app exists and is active
3. Generate a new token if needed
4. Update your `.env` file

### "Permission denied"

**Problem**: Token doesn't have required scopes

**Solution**:
1. Go to your private app settings in HubSpot
2. Check the Scopes tab
3. Ensure `content` (read & write) is enabled
4. If you changed scopes, generate a new token

### "Module not found"

**Problem**: Dependencies not installed or build not run

**Solution**:
```bash
npm install
npm run build
```

### "Server won't start in Claude"

**Problem**: Path or configuration issue

**Solution**:
1. Verify the path in `claude_desktop_config.json` is absolute
2. Ensure `dist/index.js` exists (run `npm run build`)
3. Check Claude's logs for error messages
4. Try running `node /path/to/dist/index.js` manually to see errors

## Getting Help

- Check the [full README](README.md)
- Review the [Security documentation](SECURITY.md)
- Check HubSpot's [API documentation](https://developers.hubspot.com/docs/api/overview)
- Contact Core Wrk technical team

## Development Mode

For development and testing:

```bash
# Watch mode (auto-rebuild on changes)
npm run watch

# In another terminal, run with debug logging
HUBSPOT_LOG_LEVEL=debug npm start
```

This will show detailed logs of all API requests and responses.
