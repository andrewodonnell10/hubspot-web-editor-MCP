# HubSpot CMS MCP Server

A production-ready Model Context Protocol (MCP) server that enables Claude to safely manage HubSpot CMS content. Built specifically for Core Wrk's wellness industry consulting content, with strong emphasis on safety mechanisms and the draft-first workflow.

## Features

- **Safe Draft-First Workflow**: All content modifications go to draft state, requiring explicit publishing
- **Fetch-First Pattern**: Mandatory pattern that fetches current state before updates to prevent data loss
- **Rate Limiting**: Token bucket implementation respecting HubSpot's burst and daily limits
- **Comprehensive Error Handling**: User-friendly error messages with HubSpot correlation IDs
- **Audit Trail**: Complete logging of all operations with before/after states
- **Rollback Capability**: Stores previous state for all modifications

## Prerequisites

- Node.js 18.0.0 or higher
- HubSpot private app access token with appropriate scopes
- HubSpot account with CMS Hub access

## Installation

```bash
npm install
npm run build
```

## Configuration

### Required Environment Variables

- `HUBSPOT_ACCESS_TOKEN`: Your HubSpot private app access token (required)

### Optional Environment Variables

- `HUBSPOT_RATE_LIMIT_SAFETY_MARGIN`: Percentage of rate limit to reserve as safety buffer (default: `0.1` = 10%)
- `HUBSPOT_LOG_LEVEL`: Logging verbosity level (default: `info`, options: `debug`, `info`, `warn`, `error`)

### Setting Up a HubSpot Private App

1. Log into your HubSpot account
2. Navigate to Settings → Integrations → Private Apps
3. Click "Create a private app"
4. Configure the app with required scopes:
   - `content` (read and write)
   - `oauth` (for token validation)
5. Copy the access token and set it as `HUBSPOT_ACCESS_TOKEN`

**Security Best Practice**: Never commit your access token to version control. Use environment variables or a secure secrets manager.

## Usage

### Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### Configuring with Claude Desktop

Add to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hubspot-cms": {
      "command": "node",
      "args": ["/path/to/hubspot-cms-mcp-server/dist/index.js"],
      "env": {
        "HUBSPOT_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Phase 1 Tools (MVP)

### 1. hubspot_authenticate

Validate HubSpot connection and check available permissions.

**Purpose**: First tool to call to ensure your token is valid and has appropriate scopes.

**Inputs**: None

**Outputs**:
- Hub ID and domain
- User information
- Available scopes
- Rate limit status

**Example**:
```json
{
  "success": true,
  "connection": {
    "hubId": 12345678,
    "hubDomain": "example.com",
    "userId": 98765,
    "userName": "user@example.com",
    "scopes": ["content", "oauth"]
  },
  "rateLimitStatus": {
    "dailyRemaining": 499950,
    "dailyPercentUsed": "0.01%"
  }
}
```

### 2. hubspot_list_blog_posts

Discover and list blog posts with flexible filtering options.

**Purpose**: Find blog posts for analysis, series management, or discovery.

**Inputs**:
- `limit` (number, optional): Maximum results to return (max 100, default 20)
- `offset` (number, optional): Pagination offset (default 0)
- `state` (string, optional): Filter by DRAFT, PUBLISHED, or SCHEDULED
- `authorName` (string, optional): Filter by author (partial match)
- `name` (string, optional): Filter by post title (partial match)
- `created` (string, optional): Filter posts created after date (ISO 8601)
- `updated` (string, optional): Filter posts updated after date (ISO 8601)
- `archivedInDashboard` (boolean, optional): Filter by archived status

**Outputs**:
- Total count and paginated results
- Post summaries with key metadata
- Rate limit status

**Example**:
```json
{
  "success": true,
  "total": 45,
  "count": 20,
  "posts": [
    {
      "id": "123456789",
      "name": "Understanding Wellness Practice Billing",
      "slug": "wellness-practice-billing",
      "state": "PUBLISHED",
      "authorName": "Jane Doe",
      "publishDate": "2024-01-15T10:00:00Z",
      "url": "https://example.com/blog/wellness-practice-billing"
    }
  ]
}
```

### 3. hubspot_get_blog_post

Fetch complete details for a specific blog post.

**Purpose**: MUST be called before any update operations (fetch-first pattern). Returns full post object.

**Inputs**:
- `postId` (string, required): The blog post ID

**Outputs**:
- Complete blog post object including:
  - Content (postBody)
  - All metadata
  - Tags, featured image
  - Widgets and layout sections
  - Publication status

**Example**:
```json
{
  "success": true,
  "post": {
    "id": "123456789",
    "name": "Understanding Wellness Practice Billing",
    "slug": "wellness-practice-billing",
    "state": "PUBLISHED",
    "postBody": "<html>...</html>",
    "metaDescription": "Learn about billing best practices...",
    "featuredImage": "https://...",
    "tagIds": [1, 2, 3]
  }
}
```

### 4. hubspot_update_blog_post_metadata

Safely update blog post metadata WITHOUT touching post content.

**Purpose**: Update SEO metadata, featured images, titles, slugs, authors, and tags safely. Never modifies postBody.

**Safety Guarantees**:
- Implements fetch-first pattern automatically
- Never touches postBody, widgets, or layout structures
- All changes go to draft state
- Requires explicit publishing

**Inputs**:
- `postId` (string, required): The blog post ID
- `name` (string, optional): Post title
- `slug` (string, optional): URL slug
- `metaDescription` (string, optional): Meta description for SEO
- `htmlTitle` (string, optional): HTML title tag
- `featuredImage` (string, optional): Featured image URL
- `featuredImageAltText` (string, optional): Featured image alt text
- `blogAuthorId` (string, optional): Author ID
- `authorName` (string, optional): Author name
- `tagIds` (array of numbers, optional): Tag IDs

**Outputs**:
- Updated draft post details
- Preview URL for reviewing changes
- Fields that were updated
- Rate limit status

**Example**:
```json
{
  "success": true,
  "contentId": "123456789",
  "previewUrl": "https://example.com/blog/post?preview_key=draft",
  "updatedFields": ["metaDescription", "htmlTitle"],
  "message": "✓ Draft updated successfully. Changes saved to draft (not yet published)."
}
```

### 5. hubspot_publish_blog_post_draft

Explicitly publish a blog post draft to make it live.

**Purpose**: Make draft changes visible to the public. Can publish immediately or schedule for future.

**⚠️ Warning**: This makes content publicly visible. Cannot be automatically undone.

**Inputs**:
- `postId` (string, required): The blog post draft ID
- `publishDate` (string, optional): ISO 8601 date for scheduled publishing (omit for immediate)

**Outputs**:
- Published post details
- Live URL
- Publication timestamp
- Rate limit status

**Example**:
```json
{
  "success": true,
  "contentId": "123456789",
  "liveUrl": "https://example.com/blog/wellness-practice-billing",
  "message": "✓ Blog post published successfully!"
}
```

## Core Wrk Specific Use Cases

### Blog Series Management

Create, tag, and publish educational content series on wellness practice billing and operations:

```
1. List existing posts in series: hubspot_list_blog_posts with name filter
2. Create metadata consistency across series using hubspot_update_blog_post_metadata
3. Apply consistent tags to series posts
4. Publish series posts in sequence
```

### Homepage Optimization

Optimize metadata and SEO elements:

```
1. Get current homepage post: hubspot_get_blog_post
2. Update meta description and title: hubspot_update_blog_post_metadata
3. Review draft preview
4. Publish when ready: hubspot_publish_blog_post_draft
```

### Content Discovery and Analysis

Find and analyze existing content:

```
1. List all published posts: hubspot_list_blog_posts with state=PUBLISHED
2. Review individual posts for SEO optimization opportunities
3. Update metadata to improve search visibility
```

## Safety Mechanisms

### Draft-First Workflow

All content modifications target draft endpoints (`/draft` suffix), never live content directly. Publishing requires explicit action via `hubspot_publish_blog_post_draft`.

### Fetch-First Pattern

The `hubspot_update_blog_post_metadata` tool automatically:
1. Fetches current post state
2. Merges your metadata changes
3. Validates that nested structures are preserved
4. PATCHes complete object to `/draft` endpoint

This prevents partial updates that could corrupt nested objects (widgets, layoutSections).

### Rate Limiting

Token bucket implementation with:
- **Burst limit**: 100-250 requests per 10 seconds
- **Daily limit**: Configurable (typically 500,000 for professional tier)
- **Safety margin**: 10% reserved buffer (configurable)
- **Exponential backoff**: Automatic retry with jitter on 429 errors

### Error Handling

All errors include:
- User-friendly messages (not technical jargon)
- HubSpot correlation IDs for debugging
- Actionable resolution steps
- Rate limit status

Example error:
```json
{
  "success": false,
  "error": {
    "status": "FORBIDDEN",
    "message": "Permission denied. Your access token may be missing required scopes. Original error: Missing scope: content",
    "correlationId": "abc-123-def"
  }
}
```

### Audit Trail

All operations are logged with:
- Timestamp
- Operation ID
- Before state
- After state
- User/tool that made the change

Logs are written to stderr in JSON format for easy parsing.

## API Constraints

### Pagination

Maximum 100 results per page for list operations. Use `offset` parameter for pagination.

### Partial Updates

HubSpot does not support partial updates for nested properties. This server handles this by:
- Always fetching complete objects first
- Merging changes
- Sending complete objects in PATCH requests

### Filtering Syntax

Blog post filters use double-underscore syntax:
- `name__icontains=keyword` - Case-insensitive contains
- `created__gt=2024-01-01` - Greater than date

### Draft vs. Published

- `state`: The state of the object in the request
- `currentState`: The actual current state of the content
- Draft modifications use `/draft` suffix
- Publishing uses `/draft/push-live` endpoint

## Troubleshooting

### Authentication Failed

**Error**: "Authentication failed. Please check your HUBSPOT_ACCESS_TOKEN"

**Resolution**:
1. Verify token is correct and not expired
2. Check token has required scopes (content, oauth)
3. Ensure private app is not deleted or disabled

### Permission Denied

**Error**: "Permission denied. Your access token may be missing required scopes"

**Resolution**:
1. Check private app scopes in HubSpot settings
2. Add missing scope (typically `content`)
3. Generate new access token after scope changes

### Rate Limit Exceeded

**Error**: "Rate limit exceeded. Please wait before making more requests"

**Resolution**:
1. Wait for rate limit window to reset
2. Reduce request frequency
3. Increase `HUBSPOT_RATE_LIMIT_SAFETY_MARGIN` to be more conservative

### Resource Not Found

**Error**: "Resource not found. The requested content may have been deleted"

**Resolution**:
1. Verify the post ID is correct
2. Check if post was deleted in HubSpot
3. Use `hubspot_list_blog_posts` to find correct ID

## Development

### Project Structure

```
src/
├── index.ts           # Main MCP server implementation
├── hubspot-client.ts  # HubSpot API client with error handling
├── rate-limiter.ts    # Token bucket rate limiter
├── logger.ts          # Audit trail logging
└── types.ts           # TypeScript type definitions
```

### Building

```bash
npm run build
```

Compiles TypeScript to JavaScript in `dist/` directory.

### Watching for Changes

```bash
npm run watch
```

Automatically recompiles on file changes.

### Logging

Set `HUBSPOT_LOG_LEVEL=debug` for detailed request/response logging.

## License

MIT

## Support

For issues or questions, please contact Core Wrk technical team or file an issue in the repository.

## Roadmap

**Phase 1 (Current)**: Blog post management with metadata updates

**Future Phases**:
- Phase 2: Page management and layout modifications
- Phase 3: File operations and media management
- Phase 4: Advanced features (templates, modules, themes)
