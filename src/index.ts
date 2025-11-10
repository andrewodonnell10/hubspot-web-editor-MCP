#!/usr/bin/env node

/**
 * HubSpot CMS MCP Server
 * Provides safe content management tools for HubSpot CMS via Model Context Protocol
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { HubSpotClient } from './hubspot-client.js';
import { HubSpotConfig, BlogPostListParams, BlogPostUpdateMetadata, PublishOptions } from './types.js';
import { logger } from './logger.js';

// Validate environment configuration
const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
if (!accessToken) {
  console.error('ERROR: HUBSPOT_ACCESS_TOKEN environment variable is required');
  process.exit(1);
}

// Initialize configuration
const config: HubSpotConfig = {
  accessToken,
  rateLimitSafetyMargin: parseFloat(process.env.HUBSPOT_RATE_LIMIT_SAFETY_MARGIN || '0.1'),
  logLevel: (process.env.HUBSPOT_LOG_LEVEL as any) || 'info'
};

// Initialize HubSpot client
const hubspotClient = new HubSpotClient(config);

// Initialize MCP server
const server = new Server(
  {
    name: 'hubspot-cms-mcp-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'hubspot_authenticate',
        description: 'Validate HubSpot connection and check available permissions. Returns hub information, user details, available scopes, and current rate limit status. Use this first to ensure your token is valid before performing other operations.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'hubspot_list_blog_posts',
        description: 'Discover and list blog posts with flexible filtering options. Supports filtering by state (DRAFT/PUBLISHED/SCHEDULED), author name, post name/title, creation date, update date, and archived status. Returns paginated results with metadata. Maximum 100 results per page.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (max 100)',
              default: 20
            },
            offset: {
              type: 'number',
              description: 'Number of results to skip for pagination',
              default: 0
            },
            state: {
              type: 'string',
              enum: ['DRAFT', 'PUBLISHED', 'SCHEDULED'],
              description: 'Filter by publication state'
            },
            authorName: {
              type: 'string',
              description: 'Filter by author name (partial match supported)'
            },
            name: {
              type: 'string',
              description: 'Filter by post title/name (partial match supported)'
            },
            created: {
              type: 'string',
              description: 'Filter posts created after this date (ISO 8601 format)'
            },
            updated: {
              type: 'string',
              description: 'Filter posts updated after this date (ISO 8601 format)'
            },
            archivedInDashboard: {
              type: 'boolean',
              description: 'Filter by archived status'
            }
          }
        }
      },
      {
        name: 'hubspot_get_blog_post',
        description: 'Fetch complete details for a specific blog post. Returns full object including content (postBody), metadata, tags, featured image, widgets, and layout sections. MUST be called before any update operations to implement the mandatory fetch-first pattern.',
        inputSchema: {
          type: 'object',
          properties: {
            postId: {
              type: 'string',
              description: 'The ID of the blog post to retrieve'
            }
          },
          required: ['postId']
        }
      },
      {
        name: 'hubspot_update_blog_post_metadata',
        description: 'Safely update blog post metadata WITHOUT touching the post content. This tool implements the mandatory fetch-first pattern: it fetches the current post state, merges your metadata changes, and PATCHes to the /draft endpoint. NEVER modifies postBody, widgets, or layout structures. Only updates: title (name), slug, meta description, HTML title, featured image URL/alt text, author, and tags. All changes go to draft state and require explicit publishing.',
        inputSchema: {
          type: 'object',
          properties: {
            postId: {
              type: 'string',
              description: 'The ID of the blog post to update'
            },
            name: {
              type: 'string',
              description: 'Post title/name'
            },
            slug: {
              type: 'string',
              description: 'URL slug for the post'
            },
            metaDescription: {
              type: 'string',
              description: 'Meta description for SEO'
            },
            htmlTitle: {
              type: 'string',
              description: 'HTML title tag content'
            },
            featuredImage: {
              type: 'string',
              description: 'URL of the featured image'
            },
            featuredImageAltText: {
              type: 'string',
              description: 'Alt text for the featured image'
            },
            blogAuthorId: {
              type: 'string',
              description: 'ID of the blog author'
            },
            authorName: {
              type: 'string',
              description: 'Name of the blog author'
            },
            tagIds: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of tag IDs to associate with the post'
            }
          },
          required: ['postId']
        }
      },
      {
        name: 'hubspot_publish_blog_post_draft',
        description: '⚠️ PUBLISH TO LIVE - Make a draft blog post live on your website. This is an explicit publishing action that makes content publicly visible. Can publish immediately or schedule for a future date. IMPORTANT: Only works on existing drafts. This action CANNOT be undone automatically - you would need to manually unpublish or revert. Always confirm before using this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            postId: {
              type: 'string',
              description: 'The ID of the blog post draft to publish'
            },
            publishDate: {
              type: 'string',
              description: 'Optional: ISO 8601 date/time for scheduled publishing. If omitted, publishes immediately.'
            }
          },
          required: ['postId']
        }
      }
    ]
  };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    logger.info('Tool called', { tool: name, arguments: args });

    // Ensure args is defined (can be empty object)
    const toolArgs = args || {};

    switch (name) {
      case 'hubspot_authenticate': {
        const result = await hubspotClient.validateToken();

        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  rateLimitStatus: result.rateLimitStatus
                }, null, 2)
              }
            ]
          };
        }

        const data = result.data!;
        const rateLimitStatus = hubspotClient.getRateLimitStatus();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                connection: {
                  hubId: data.hub_id,
                  hubDomain: data.hub_domain,
                  userId: data.user_id,
                  userName: data.user,
                  appId: data.app_id,
                  tokenType: data.token_type,
                  expiresAt: new Date(data.expires_at).toISOString()
                },
                scopes: data.scopes,
                rateLimitStatus: {
                  dailyRemaining: rateLimitStatus.dailyRemaining,
                  burstRemaining: rateLimitStatus.burstRemaining,
                  dailyPercentUsed: `${rateLimitStatus.dailyPercentUsed.toFixed(1)}%`,
                  burstPercentUsed: `${rateLimitStatus.burstPercentUsed.toFixed(1)}%`
                },
                message: 'Authentication successful! Your HubSpot connection is active.'
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_list_blog_posts': {
        const params: BlogPostListParams = {
          limit: toolArgs.limit as number | undefined,
          offset: toolArgs.offset as number | undefined,
          state: toolArgs.state as 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | undefined,
          authorName: toolArgs.authorName as string | undefined,
          name: toolArgs.name as string | undefined,
          created: toolArgs.created as string | undefined,
          updated: toolArgs.updated as string | undefined,
          archivedInDashboard: toolArgs.archivedInDashboard as boolean | undefined
        };

        const result = await hubspotClient.listBlogPosts(params);

        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  rateLimitStatus: result.rateLimitStatus
                }, null, 2)
              }
            ]
          };
        }

        const data = result.data!;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                total: data.total,
                count: data.results.length,
                offset: params.offset || 0,
                limit: params.limit || 20,
                posts: data.results.map(post => ({
                  id: post.id,
                  name: post.name,
                  slug: post.slug,
                  state: post.state,
                  authorName: post.authorName,
                  publishDate: post.publishDate,
                  created: post.created,
                  updated: post.updated,
                  url: post.url,
                  metaDescription: post.metaDescription,
                  featuredImage: post.featuredImage
                })),
                rateLimitStatus: result.rateLimitStatus,
                message: `Found ${data.total} blog post(s) matching criteria. Showing ${data.results.length} result(s).`
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_get_blog_post': {
        if (!toolArgs.postId) {
          throw new McpError(ErrorCode.InvalidParams, 'postId is required');
        }

        const result = await hubspotClient.getBlogPost(toolArgs.postId as string);

        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  rateLimitStatus: result.rateLimitStatus
                }, null, 2)
              }
            ]
          };
        }

        const post = result.data!;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                post: {
                  id: post.id,
                  name: post.name,
                  slug: post.slug,
                  state: post.state,
                  currentState: post.currentState,
                  postBody: post.postBody,
                  metaDescription: post.metaDescription,
                  htmlTitle: post.htmlTitle,
                  featuredImage: post.featuredImage,
                  featuredImageAltText: post.featuredImageAltText,
                  authorName: post.authorName,
                  blogAuthorId: post.blogAuthorId,
                  tagIds: post.tagIds,
                  publishDate: post.publishDate,
                  created: post.created,
                  updated: post.updated,
                  url: post.url,
                  absoluteUrl: post.absoluteUrl,
                  currentlyPublished: post.currentlyPublished
                },
                rateLimitStatus: result.rateLimitStatus,
                message: 'Blog post retrieved successfully.'
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_update_blog_post_metadata': {
        if (!toolArgs.postId) {
          throw new McpError(ErrorCode.InvalidParams, 'postId is required');
        }

        const metadata: BlogPostUpdateMetadata = {};
        if (toolArgs.name) metadata.name = toolArgs.name as string;
        if (toolArgs.slug) metadata.slug = toolArgs.slug as string;
        if (toolArgs.metaDescription) metadata.metaDescription = toolArgs.metaDescription as string;
        if (toolArgs.htmlTitle) metadata.htmlTitle = toolArgs.htmlTitle as string;
        if (toolArgs.featuredImage) metadata.featuredImage = toolArgs.featuredImage as string;
        if (toolArgs.featuredImageAltText) metadata.featuredImageAltText = toolArgs.featuredImageAltText as string;
        if (toolArgs.blogAuthorId) metadata.blogAuthorId = toolArgs.blogAuthorId as string;
        if (toolArgs.authorName) metadata.authorName = toolArgs.authorName as string;
        if (toolArgs.tagIds) metadata.tagIds = toolArgs.tagIds as number[];

        const result = await hubspotClient.updateBlogPostMetadata(
          toolArgs.postId as string,
          metadata
        );

        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  rateLimitStatus: result.rateLimitStatus
                }, null, 2)
              }
            ]
          };
        }

        const post = result.data!;
        const previewUrl = post.url ? `${post.url}?preview_key=${post.previewKey || 'draft'}` : undefined;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                contentId: post.id,
                previewUrl,
                updatedFields: Object.keys(metadata),
                post: {
                  id: post.id,
                  name: post.name,
                  slug: post.slug,
                  state: post.state,
                  metaDescription: post.metaDescription,
                  htmlTitle: post.htmlTitle,
                  featuredImage: post.featuredImage,
                  featuredImageAltText: post.featuredImageAltText,
                  updated: post.updated
                },
                rateLimitStatus: result.rateLimitStatus,
                message: `✓ Draft updated successfully. Changes saved to draft (not yet published). Preview at: ${previewUrl || 'N/A'}`
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_publish_blog_post_draft': {
        if (!toolArgs.postId) {
          throw new McpError(ErrorCode.InvalidParams, 'postId is required');
        }

        const options: PublishOptions = {};
        if (toolArgs.publishDate) {
          options.publishDate = toolArgs.publishDate as string;
        }

        const result = await hubspotClient.publishBlogPostDraft(
          toolArgs.postId as string,
          options
        );

        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  rateLimitStatus: result.rateLimitStatus
                }, null, 2)
              }
            ]
          };
        }

        const post = result.data!;
        const isScheduled = options.publishDate !== undefined;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                contentId: post.id,
                liveUrl: post.absoluteUrl,
                publishDate: post.publishDate,
                state: post.state,
                rateLimitStatus: result.rateLimitStatus,
                message: isScheduled
                  ? `✓ Blog post scheduled for publishing on ${options.publishDate}. It will go live automatically at the scheduled time.`
                  : `✓ Blog post published successfully! Now live at: ${post.absoluteUrl}`
              }, null, 2)
            }
          ]
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    logger.error('Tool execution failed', { error });

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

/**
 * Start the server
 */
async function main() {
  logger.info('Starting HubSpot CMS MCP Server', { version: '1.0.0' });

  // Validate connection on startup
  const validation = await hubspotClient.validateToken();
  if (!validation.success) {
    logger.error('Failed to validate HubSpot token on startup', { error: validation.error });
    console.error('ERROR: Failed to validate HubSpot token. Please check your HUBSPOT_ACCESS_TOKEN.');
    console.error(JSON.stringify(validation.error, null, 2));
    process.exit(1);
  }

  logger.info('HubSpot connection validated', {
    hubId: validation.data!.hub_id,
    scopes: validation.data!.scopes
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Server started successfully');
}

main().catch((error) => {
  logger.error('Fatal error', { error });
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
