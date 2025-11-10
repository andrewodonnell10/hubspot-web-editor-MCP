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
      },
      // Phase 2: Content creation and file management
      {
        name: 'hubspot_create_blog_post',
        description: 'Create a new blog post in DRAFT state. Supports creating posts with title, slug, content, author, tags, featured image, and metadata. All posts are created as drafts requiring explicit publication. Returns the created post ID and preview URL. Perfect for AI-assisted content creation with human review before going live.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Internal name/title of the blog post'
            },
            slug: {
              type: 'string',
              description: 'URL slug for the post (e.g., "my-blog-post" becomes /blog/my-blog-post)'
            },
            contentGroupId: {
              type: 'string',
              description: 'Optional: Blog ID to publish to. If not provided, uses the default blog.'
            },
            blogAuthorId: {
              type: 'string',
              description: 'Optional: ID of the blog author'
            },
            htmlTitle: {
              type: 'string',
              description: 'Optional: HTML title tag content (SEO title)'
            },
            postBody: {
              type: 'string',
              description: 'Optional: HTML content of the blog post. Can be added later with update_content.'
            },
            postSummary: {
              type: 'string',
              description: 'Optional: Brief summary for blog listing pages'
            },
            metaDescription: {
              type: 'string',
              description: 'Optional: Meta description for SEO'
            },
            tagIds: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional: Array of tag IDs to associate with the post'
            },
            featuredImage: {
              type: 'string',
              description: 'Optional: URL of the featured image (use hubspot_upload_file first)'
            },
            featuredImageAltText: {
              type: 'string',
              description: 'Optional: Alt text for the featured image'
            }
          },
          required: ['name', 'slug']
        }
      },
      {
        name: 'hubspot_update_blog_post_content',
        description: 'Update the content body (postBody) of an existing blog post. Uses fetch-first pattern to safely modify content while preserving all other properties. Updates are saved to DRAFT state, requiring explicit publishing. IMPORTANT: This modifies the actual post content (HTML). Always generate a preview URL after content updates for human review.',
        inputSchema: {
          type: 'object',
          properties: {
            postId: {
              type: 'string',
              description: 'The ID of the blog post to update'
            },
            postBody: {
              type: 'string',
              description: 'HTML content for the blog post'
            },
            postSummary: {
              type: 'string',
              description: 'Optional: Brief summary for blog listing pages'
            }
          },
          required: ['postId', 'postBody']
        }
      },
      {
        name: 'hubspot_upload_file',
        description: 'Upload a file (image, PDF, document) to HubSpot File Manager. Supports uploading from URL or base64 encoded content. Returns the CDN URL which can be used in blog posts as featured images or embedded content. Files are uploaded with PUBLIC_INDEXABLE access by default for SEO.',
        inputSchema: {
          type: 'object',
          properties: {
            fileContent: {
              type: 'string',
              description: 'File content as base64 encoded string (data:image/png;base64,...) or URL (http://...)'
            },
            fileName: {
              type: 'string',
              description: 'Name of the file including extension (e.g., "featured-image.jpg")'
            },
            folderPath: {
              type: 'string',
              description: 'Optional: Folder path in HubSpot File Manager (e.g., "/images/blog"). Defaults to root.'
            },
            access: {
              type: 'string',
              enum: ['PUBLIC_INDEXABLE', 'PUBLIC_NOT_INDEXABLE', 'PRIVATE'],
              description: 'Optional: Access level. PUBLIC_INDEXABLE (default) for SEO, PUBLIC_NOT_INDEXABLE for downloads, PRIVATE for authenticated access only.'
            },
            ttl: {
              type: 'string',
              description: 'Optional: Time to live (e.g., "P3M" for 3 months). Defaults to never expire.'
            }
          },
          required: ['fileContent', 'fileName']
        }
      },
      {
        name: 'hubspot_list_blog_tags',
        description: 'Retrieve all blog tags with optional search filtering. Returns tag IDs, names, and slugs for use in content categorization. Use this to discover existing tags before creating blog posts to ensure consistent taxonomy.',
        inputSchema: {
          type: 'object',
          properties: {
            searchTerm: {
              type: 'string',
              description: 'Optional: Search term to filter tags by name (partial match supported)'
            }
          }
        }
      },
      {
        name: 'hubspot_get_draft_preview_url',
        description: 'Generate a preview URL for draft content to enable human review before publication. Returns a URL with preview token that displays the draft version. Essential for the review workflow: create/update content, generate preview, human approves, then publish.',
        inputSchema: {
          type: 'object',
          properties: {
            contentId: {
              type: 'string',
              description: 'The ID of the blog post or page'
            },
            contentType: {
              type: 'string',
              enum: ['blog-post', 'site-page', 'landing-page'],
              description: 'Type of content (currently only blog-post is fully supported)'
            }
          },
          required: ['contentId', 'contentType']
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

        // Build connection info, handling both OAuth and Private App token responses
        const connectionInfo: any = {
          authenticated: true
        };

        // Add available fields from the response
        if (data.hub_id) connectionInfo.hubId = data.hub_id;
        if (data.hub_domain) connectionInfo.hubDomain = data.hub_domain;
        if (data.user_id) connectionInfo.userId = data.user_id;
        if (data.user) connectionInfo.userName = data.user;
        if (data.app_id) connectionInfo.appId = data.app_id;
        if (data.token_type) connectionInfo.tokenType = data.token_type;
        if (data.expires_at) connectionInfo.expiresAt = new Date(data.expires_at).toISOString();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                connection: connectionInfo,
                scopes: data.scopes || [],
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

      // Phase 2: Content creation and file management
      case 'hubspot_create_blog_post': {
        if (!toolArgs.name || !toolArgs.slug) {
          throw new McpError(ErrorCode.InvalidParams, 'name and slug are required');
        }

        const createParams: any = {
          name: toolArgs.name as string,
          slug: toolArgs.slug as string
        };

        // Add optional parameters
        if (toolArgs.contentGroupId) createParams.contentGroupId = toolArgs.contentGroupId as string;
        if (toolArgs.blogAuthorId) createParams.blogAuthorId = toolArgs.blogAuthorId as string;
        if (toolArgs.htmlTitle) createParams.htmlTitle = toolArgs.htmlTitle as string;
        if (toolArgs.postBody) createParams.postBody = toolArgs.postBody as string;
        if (toolArgs.postSummary) createParams.postSummary = toolArgs.postSummary as string;
        if (toolArgs.metaDescription) createParams.metaDescription = toolArgs.metaDescription as string;
        if (toolArgs.tagIds) createParams.tagIds = toolArgs.tagIds as number[];
        if (toolArgs.featuredImage) createParams.featuredImage = toolArgs.featuredImage as string;
        if (toolArgs.featuredImageAltText) createParams.featuredImageAltText = toolArgs.featuredImageAltText as string;

        const result = await hubspotClient.createBlogPost(createParams);

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
        const previewUrl = post.url ? `${post.url}?hs_preview=${post.previewKey || 'draft'}` : undefined;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                contentId: post.id,
                previewUrl,
                post: {
                  id: post.id,
                  name: post.name,
                  slug: post.slug,
                  state: post.state,
                  url: post.url
                },
                rateLimitStatus: result.rateLimitStatus,
                message: `✓ Blog post created successfully in DRAFT state. Preview at: ${previewUrl || 'N/A'}. Use hubspot_publish_blog_post_draft to publish when ready.`
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_update_blog_post_content': {
        if (!toolArgs.postId || !toolArgs.postBody) {
          throw new McpError(ErrorCode.InvalidParams, 'postId and postBody are required');
        }

        const contentUpdate: any = {
          postBody: toolArgs.postBody as string
        };

        if (toolArgs.postSummary) {
          contentUpdate.postSummary = toolArgs.postSummary as string;
        }

        const result = await hubspotClient.updateBlogPostContent(
          toolArgs.postId as string,
          contentUpdate
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
        const previewUrl = post.url ? `${post.url}?hs_preview=${post.previewKey || 'draft'}` : undefined;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                contentId: post.id,
                previewUrl,
                post: {
                  id: post.id,
                  name: post.name,
                  state: post.state,
                  updated: post.updated
                },
                rateLimitStatus: result.rateLimitStatus,
                message: `✓ Blog post content updated successfully. Changes saved to DRAFT (not yet published). Preview at: ${previewUrl || 'N/A'}`
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_upload_file': {
        if (!toolArgs.fileContent || !toolArgs.fileName) {
          throw new McpError(ErrorCode.InvalidParams, 'fileContent and fileName are required');
        }

        const uploadParams: any = {
          fileContent: toolArgs.fileContent as string,
          fileName: toolArgs.fileName as string
        };

        if (toolArgs.folderPath) uploadParams.folderPath = toolArgs.folderPath as string;
        if (toolArgs.access) uploadParams.access = toolArgs.access as 'PUBLIC_INDEXABLE' | 'PUBLIC_NOT_INDEXABLE' | 'PRIVATE';
        if (toolArgs.ttl) uploadParams.ttl = toolArgs.ttl as string;

        const result = await hubspotClient.uploadFile(uploadParams);

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

        const file = result.data!;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                file: {
                  id: file.id,
                  url: file.url,
                  name: file.name,
                  path: file.path,
                  type: file.type,
                  size: file.size
                },
                rateLimitStatus: result.rateLimitStatus,
                message: `✓ File uploaded successfully! Use this URL in your content: ${file.url}`
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_list_blog_tags': {
        const searchTerm = toolArgs.searchTerm as string | undefined;

        const result = await hubspotClient.listBlogTags(searchTerm);

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
                tags: data.results.map(tag => ({
                  id: tag.id,
                  name: tag.name,
                  slug: tag.slug
                })),
                rateLimitStatus: result.rateLimitStatus,
                message: `Found ${data.total} blog tag(s)${searchTerm ? ` matching "${searchTerm}"` : ''}. Use tag IDs when creating or updating blog posts.`
              }, null, 2)
            }
          ]
        };
      }

      case 'hubspot_get_draft_preview_url': {
        if (!toolArgs.contentId || !toolArgs.contentType) {
          throw new McpError(ErrorCode.InvalidParams, 'contentId and contentType are required');
        }

        const params: any = {
          contentId: toolArgs.contentId as string,
          contentType: toolArgs.contentType as 'blog-post' | 'site-page' | 'landing-page'
        };

        const result = await hubspotClient.getDraftPreviewUrl(params);

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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                previewUrl: result.data!.previewUrl,
                rateLimitStatus: result.rateLimitStatus,
                message: `✓ Preview URL generated. Review the draft content at: ${result.data!.previewUrl}`
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
