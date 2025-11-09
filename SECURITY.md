# Security Best Practices

## Token Management

### Never Commit Tokens

Your HubSpot access token provides full access to your CMS content. **NEVER** commit it to version control.

**Bad**:
```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx
git add .env
git commit -m "Add config"  # ❌ DO NOT DO THIS
```

**Good**:
```bash
# Add .env to .gitignore (already done in this project)
echo ".env" >> .gitignore

# Store token in .env file (not committed)
echo "HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx" > .env

# Or use environment variables
export HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx
```

### Token Rotation

Rotate your access tokens regularly:

1. Create a new private app with the same scopes
2. Update `HUBSPOT_ACCESS_TOKEN` with new token
3. Test the new token works
4. Delete the old private app

### Least Privilege

Only grant the minimum required scopes:

**Required Scopes**:
- `content` (read and write) - For blog post management
- `oauth` (read) - For token validation

**Not Required** (unless future features need them):
- `automation`
- `contacts`
- `files` (future phase)
- `settings`

### Token Storage

**Development**:
- Use `.env` file (already in `.gitignore`)
- Use environment variables in your shell

**Production**:
- Use environment variables
- Use secrets management service (AWS Secrets Manager, Azure Key Vault, etc.)
- Use CI/CD pipeline secrets (GitHub Secrets, GitLab CI Variables, etc.)

### Access Control

Limit who can access your HubSpot private apps:

1. In HubSpot Settings → Users & Teams
2. Restrict private app creation to administrators
3. Review private apps regularly
4. Delete unused apps immediately

## Content Safety

### Draft-First Workflow

This server is designed with safety as the top priority:

- **All modifications go to draft** - Never touches live content directly
- **Fetch-first pattern** - Always gets current state before modifying
- **Explicit publishing** - Requires separate action to make changes live
- **Audit trail** - Logs all operations with before/after states

### Validation Before Publishing

Always review drafts before publishing:

1. Use `hubspot_update_blog_post_metadata` to make changes
2. Visit the preview URL in the response
3. Review changes carefully
4. Only then use `hubspot_publish_blog_post_draft`

### Rollback Strategy

If you publish incorrect content:

1. Check audit logs for previous state
2. Use `hubspot_update_blog_post_metadata` to revert changes
3. Use `hubspot_publish_blog_post_draft` to publish corrected version

Or manually in HubSpot:

1. Go to Content → Blog Posts
2. Click on the post
3. Use "Restore previous version" from version history

## Rate Limiting

### Preventing API Exhaustion

The server includes built-in rate limiting protection:

- **Safety margin**: 10% buffer by default (configurable)
- **Automatic retry**: Exponential backoff on rate limit errors
- **Status monitoring**: Every response includes rate limit status

### Best Practices

1. **Don't disable safety margin** - The 10% buffer prevents accidental exhaustion
2. **Monitor rate usage** - Check `rateLimitStatus` in responses
3. **Batch operations wisely** - Space out bulk operations
4. **Increase margin if needed** - Set `HUBSPOT_RATE_LIMIT_SAFETY_MARGIN=0.2` for 20% buffer

## Error Handling

### Correlation IDs

All HubSpot API errors include a correlation ID. Save these for debugging:

```json
{
  "error": {
    "correlationId": "abc-123-def-456"
  }
}
```

Contact HubSpot support with this ID if you need help debugging API issues.

### Logging

Logs contain sensitive operation details. Secure your log files:

1. **Don't commit logs** - Already in `.gitignore`
2. **Rotate logs** - Don't let log files grow indefinitely
3. **Secure log access** - Restrict who can read logs
4. **Redact tokens** - Logs never contain full tokens (only last 4 chars for debugging)

## Network Security

### HTTPS Only

All HubSpot API requests use HTTPS. Never:
- Modify the `baseUrl` to use HTTP
- Disable certificate validation
- Use proxy that downgrades to HTTP

### Firewall Rules

If running in a restricted environment:

**Allow outbound HTTPS to**:
- `api.hubapi.com` (port 443)

## Incident Response

### If Token is Compromised

1. **Immediately** delete the private app in HubSpot
2. Review audit logs for unauthorized changes
3. Create new private app with new token
4. Review all content modified by compromised token
5. Rotate any other shared credentials

### If Unauthorized Changes Made

1. Check audit logs (`HUBSPOT_LOG_LEVEL=debug`)
2. Use HubSpot's version history to review changes
3. Restore previous versions if needed
4. Review access controls and tokens

## Compliance

### Data Protection

HubSpot content may contain:
- Customer information
- Proprietary business information
- Personal data (GDPR, CCPA)

Ensure your usage complies with:
- Your organization's data policies
- HubSpot's Terms of Service
- Applicable privacy regulations

### Audit Requirements

If you have compliance requirements:

1. **Enable debug logging**: `HUBSPOT_LOG_LEVEL=debug`
2. **Save logs**: Configure log aggregation
3. **Regular reviews**: Audit who has access to tokens
4. **Document changes**: Use the audit trail for compliance reports

## Questions?

Contact Core Wrk's technical team or HubSpot support for security concerns.
