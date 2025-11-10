/**
 * HubSpot API Client with comprehensive error handling and rate limiting
 */

import {
  HubSpotConfig,
  HubSpotResponse,
  HubSpotError,
  TokenValidationResponse,
  BlogPost,
  BlogPostListParams,
  PaginatedResponse,
  BlogPostUpdateMetadata,
  PublishOptions,
  BlogPostCreateParams,
  BlogPostContentUpdate,
  FileUploadParams,
  FileUploadResponse,
  BlogTag,
  PreviewUrlParams
} from './types.js';
import { RateLimiter } from './rate-limiter.js';
import { logger } from './logger.js';

export class HubSpotClient {
  private config: HubSpotConfig;
  private rateLimiter: RateLimiter;
  private baseUrl = 'https://api.hubapi.com';
  private maxRetries = 4;

  constructor(config: HubSpotConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rateLimitSafetyMargin);
  }

  /**
   * Make an HTTP request to HubSpot API with error handling and retries
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    attempt: number = 0
  ): Promise<HubSpotResponse<T>> {
    // Check rate limits before making request
    if (!this.rateLimiter.canMakeRequest()) {
      return {
        success: false,
        error: {
          status: 'RATE_LIMIT_SAFETY',
          message: 'Approaching rate limit threshold. Request blocked by safety margin.',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.config.accessToken}`);
    headers.set('Content-Type', 'application/json');

    logger.debug(`Request: ${options.method || 'GET'} ${endpoint}`, {
      attempt,
      body: options.body
    });

    try {
      this.rateLimiter.recordRequest();

      const response = await fetch(url, {
        ...options,
        headers
      });

      // Update rate limits from response headers
      this.rateLimiter.updateFromHeaders(response.headers);

      // Handle rate limiting with exponential backoff
      if (response.status === 429 && attempt < this.maxRetries) {
        const delay = this.rateLimiter.calculateBackoff(attempt);
        logger.warn(`Rate limited, retrying after ${delay}ms`, { attempt });
        await this.sleep(delay);
        return this.request<T>(endpoint, options, attempt + 1);
      }

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = this.parseError(response, responseData);
        logger.error('API request failed', { endpoint, error });

        return {
          success: false,
          error,
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      logger.debug('Request successful', { endpoint, status: response.status });

      return {
        success: true,
        data: responseData as T,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    } catch (error) {
      // Handle network errors with retry
      if (attempt < this.maxRetries) {
        const delay = this.rateLimiter.calculateBackoff(attempt);
        logger.warn(`Network error, retrying after ${delay}ms`, { attempt, error });
        await this.sleep(delay);
        return this.request<T>(endpoint, options, attempt + 1);
      }

      logger.error('Request failed after retries', { endpoint, error });

      return {
        success: false,
        error: {
          status: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown network error',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }
  }

  /**
   * Parse HubSpot error response into user-friendly format
   */
  private parseError(response: Response, data: any): HubSpotError {
    const correlationId = response.headers.get('X-HubSpot-Correlation-Id') || 'N/A';

    // Handle common error formats
    if (data.message) {
      return {
        status: data.status || response.statusText,
        message: this.makeFriendlyErrorMessage(response.status, data.message),
        correlationId,
        category: data.category,
        subCategory: data.subCategory,
        errors: data.errors
      };
    }

    // Fallback for unknown error format
    return {
      status: response.statusText,
      message: this.makeFriendlyErrorMessage(response.status, 'Unknown error occurred'),
      correlationId
    };
  }

  /**
   * Convert technical errors to user-friendly messages
   */
  private makeFriendlyErrorMessage(status: number, message: string): string {
    switch (status) {
      case 401:
        return 'Authentication failed. Please check your HUBSPOT_ACCESS_TOKEN is valid and not expired.';
      case 403:
        return `Permission denied. Your access token may be missing required scopes. Original error: ${message}`;
      case 404:
        return `Resource not found. The requested content may have been deleted or the ID is incorrect. Original error: ${message}`;
      case 429:
        return 'Rate limit exceeded. Please wait before making more requests.';
      case 500:
      case 502:
      case 503:
        return `HubSpot service error. Please try again later. Original error: ${message}`;
      default:
        return message;
    }
  }

  /**
   * Sleep helper for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate token and get connection information
   * For Private App tokens, we validate by making a test API call to get account details
   */
  async validateToken(): Promise<HubSpotResponse<TokenValidationResponse>> {
    return this.request<TokenValidationResponse>(
      `/integrations/v1/me`,
      { method: 'GET' }
    );
  }

  /**
   * List blog posts with filtering and pagination
   */
  async listBlogPosts(
    params: BlogPostListParams = {}
  ): Promise<HubSpotResponse<PaginatedResponse<BlogPost>>> {
    const queryParams = new URLSearchParams();

    // Add pagination
    if (params.limit) queryParams.set('limit', Math.min(params.limit, 100).toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());

    // Add filters using double-underscore syntax
    if (params.state) queryParams.set('state', params.state);
    if (params.authorName) queryParams.set('authorName__icontains', params.authorName);
    if (params.name) queryParams.set('name__icontains', params.name);
    if (params.created) queryParams.set('created__gt', params.created);
    if (params.updated) queryParams.set('updated__gt', params.updated);
    if (params.archivedInDashboard !== undefined) {
      queryParams.set('archivedInDashboard', params.archivedInDashboard.toString());
    }

    const endpoint = `/cms/v3/blogs/posts?${queryParams.toString()}`;
    return this.request<PaginatedResponse<BlogPost>>(endpoint, { method: 'GET' });
  }

  /**
   * Get complete blog post details
   */
  async getBlogPost(postId: string): Promise<HubSpotResponse<BlogPost>> {
    logger.info('Fetching blog post', { postId });
    return this.request<BlogPost>(`/cms/v3/blogs/posts/${postId}`, { method: 'GET' });
  }

  /**
   * Update blog post metadata using fetch-first pattern
   * CRITICAL: This never modifies postBody to prevent data loss
   */
  async updateBlogPostMetadata(
    postId: string,
    metadata: BlogPostUpdateMetadata
  ): Promise<HubSpotResponse<BlogPost>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting metadata update with fetch-first pattern', { opId, postId });

    // STEP 1: Fetch current state
    const currentResponse = await this.getBlogPost(postId);
    if (!currentResponse.success || !currentResponse.data) {
      logger.error('Failed to fetch current state', { opId, postId });
      return currentResponse;
    }

    const beforeState = currentResponse.data;
    logger.info('Fetched current state', { opId, postId });

    // STEP 2: Merge metadata (explicitly exclude postBody)
    const updatedPost = {
      ...beforeState,
      ...metadata,
      // Ensure we never touch the post body
      postBody: beforeState.postBody,
      // Preserve critical nested structures
      widgets: beforeState.widgets,
      widgetContainers: beforeState.widgetContainers,
      layoutSections: beforeState.layoutSections
    };

    // STEP 3: PATCH to draft endpoint
    logger.info('Updating draft with merged data', { opId, postId });
    const response = await this.request<BlogPost>(
      `/cms/v3/blogs/posts/${postId}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify(updatedPost)
      }
    );

    if (response.success) {
      logger.logOperation(
        'update_blog_post_metadata',
        { opId, postId, metadata },
        beforeState,
        response.data
      );
    }

    return response;
  }

  /**
   * Publish a blog post draft
   * Can publish immediately or schedule for future date
   */
  async publishBlogPostDraft(
    postId: string,
    options: PublishOptions = {}
  ): Promise<HubSpotResponse<BlogPost>> {
    const opId = logger.getNextOperationId();
    logger.info('Publishing blog post draft', { opId, postId, options });

    // Fetch current draft state for audit log
    const currentResponse = await this.getBlogPost(postId);
    const beforeState = currentResponse.success ? currentResponse.data : undefined;

    const body: any = {};

    // Add scheduled publishing date if provided
    if (options.publishDate) {
      body.publishDate = options.publishDate;
    }

    const response = await this.request<BlogPost>(
      `/cms/v3/blogs/posts/${postId}/draft/push-live`,
      {
        method: 'POST',
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
      }
    );

    if (response.success) {
      logger.logOperation(
        'publish_blog_post',
        { opId, postId, options },
        beforeState,
        response.data
      );
    }

    return response;
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  // ========================================
  // Phase 2: Content creation and file management
  // ========================================

  /**
   * Create a new blog post in draft state
   * Inputs: name, slug, content_body (optional), author_id, tag_ids, meta_description, summary
   * Output: Created post with draft state
   * Implementation: POST /cms/v3/blogs/posts with state: "DRAFT"
   * Purpose: AI-assisted content creation starting from draft
   */
  async createBlogPost(
    params: BlogPostCreateParams
  ): Promise<HubSpotResponse<BlogPost>> {
    const opId = logger.getNextOperationId();
    logger.info('Creating blog post draft', { opId, params });

    // Build request body with DRAFT state
    const requestBody: any = {
      name: params.name,
      slug: params.slug,
      state: 'DRAFT'  // Always create as draft for safety
    };

    // Add optional fields
    if (params.contentGroupId) requestBody.contentGroupId = params.contentGroupId;
    if (params.blogAuthorId) requestBody.blogAuthorId = params.blogAuthorId;
    if (params.htmlTitle) requestBody.htmlTitle = params.htmlTitle;
    if (params.postBody) requestBody.postBody = params.postBody;
    if (params.postSummary) requestBody.postSummary = params.postSummary;
    if (params.metaDescription) requestBody.metaDescription = params.metaDescription;
    if (params.tagIds && params.tagIds.length > 0) requestBody.tagIds = params.tagIds;
    if (params.featuredImage) {
      requestBody.useFeaturedImage = true;
      requestBody.featuredImage = params.featuredImage;
    }
    if (params.featuredImageAltText) requestBody.featuredImageAltText = params.featuredImageAltText;

    const response = await this.request<BlogPost>(
      '/cms/v3/blogs/posts',
      {
        method: 'POST',
        body: JSON.stringify(requestBody)
      }
    );

    if (response.success) {
      logger.logOperation(
        'create_blog_post',
        { opId, params },
        undefined,
        response.data
      );
    }

    return response;
  }

  /**
   * Update blog post content (postBody) using fetch-first pattern
   * Inputs: post_id, content_body (HTML string), summary
   * Output: Updated draft
   * Implementation: Fetch current → modify postBody → PATCH /draft with full object
   * Safety: Preview required before publishing
   * Purpose: AI content generation and editing
   */
  async updateBlogPostContent(
    postId: string,
    content: BlogPostContentUpdate
  ): Promise<HubSpotResponse<BlogPost>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting content update with fetch-first pattern', { opId, postId });

    // STEP 1: Fetch current state
    const currentResponse = await this.getBlogPost(postId);
    if (!currentResponse.success || !currentResponse.data) {
      logger.error('Failed to fetch current state', { opId, postId });
      return currentResponse;
    }

    const beforeState = currentResponse.data;
    logger.info('Fetched current state for content update', { opId, postId });

    // STEP 2: Merge content changes with full object
    const updatedPost = {
      ...beforeState,
      postBody: content.postBody
    };

    // Add postSummary if provided
    if (content.postSummary !== undefined) {
      updatedPost.postSummary = content.postSummary;
    }

    // STEP 3: PATCH to draft endpoint with complete object
    logger.info('Updating draft with new content', { opId, postId });
    const response = await this.request<BlogPost>(
      `/cms/v3/blogs/posts/${postId}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify(updatedPost)
      }
    );

    if (response.success) {
      logger.logOperation(
        'update_blog_post_content',
        { opId, postId, contentLength: content.postBody.length },
        beforeState,
        response.data
      );
    }

    return response;
  }

  /**
   * Upload a file to HubSpot File Manager
   * Inputs: file_path or file_url, folder_path, access_level, file_name
   * Output: File URL for use in content
   * Implementation: POST /files/v3/files with multipart/form-data
   * Purpose: Asset management for AI-generated or selected images
   */
  async uploadFile(
    params: FileUploadParams
  ): Promise<HubSpotResponse<FileUploadResponse>> {
    const opId = logger.getNextOperationId();
    logger.info('Uploading file to HubSpot', { opId, fileName: params.fileName });

    // Note: For file uploads, we need to use multipart/form-data
    // This is a simplified implementation that assumes the file content is base64 encoded
    // In a production environment, you might want to handle file streams differently

    const formData = new FormData();

    // Convert base64 to blob if needed
    let fileBlob: Blob;
    if (params.fileContent.startsWith('http://') || params.fileContent.startsWith('https://')) {
      // If it's a URL, fetch the file first
      try {
        const fileResponse = await fetch(params.fileContent);
        fileBlob = await fileResponse.blob();
      } catch (error) {
        logger.error('Failed to fetch file from URL', { opId, url: params.fileContent, error });
        return {
          success: false,
          error: {
            status: 'FILE_FETCH_ERROR',
            message: `Failed to fetch file from URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
            correlationId: 'N/A'
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }
    } else {
      // Assume it's base64 encoded
      const base64Data = params.fileContent.replace(/^data:[^;]+;base64,/, '');
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBlob = new Blob([bytes]);
    }

    formData.append('file', fileBlob, params.fileName);

    // Add options as JSON string
    const options: any = {
      access: params.access || 'PUBLIC_INDEXABLE',
      duplicateValidationStrategy: 'NONE'
    };

    if (params.ttl) {
      options.ttl = params.ttl;
    }

    formData.append('options', JSON.stringify(options));

    if (params.folderPath) {
      formData.append('folderPath', params.folderPath);
    }

    // Check rate limits before making request
    if (!this.rateLimiter.canMakeRequest()) {
      return {
        success: false,
        error: {
          status: 'RATE_LIMIT_SAFETY',
          message: 'Approaching rate limit threshold. Request blocked by safety margin.',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const url = `${this.baseUrl}/files/v3/files`;
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${this.config.accessToken}`);
    // Don't set Content-Type for FormData - browser will set it with boundary

    try {
      this.rateLimiter.recordRequest();

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData
      });

      // Update rate limits from response headers
      this.rateLimiter.updateFromHeaders(response.headers);

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = this.parseError(response, responseData);
        logger.error('File upload failed', { opId, error });

        return {
          success: false,
          error,
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      const fileData = responseData as FileUploadResponse;
      logger.info('File uploaded successfully', { opId, fileUrl: fileData.url });

      return {
        success: true,
        data: fileData,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    } catch (error) {
      logger.error('File upload request failed', { opId, error });

      return {
        success: false,
        error: {
          status: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown network error',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }
  }

  /**
   * List blog tags with optional search
   * Inputs: search_term (optional)
   * Output: Array of tags with id, name, slug
   * Implementation: GET /cms/v3/blogs/tags
   * Purpose: Tag selection for content categorization
   */
  async listBlogTags(searchTerm?: string): Promise<HubSpotResponse<PaginatedResponse<BlogTag>>> {
    const queryParams = new URLSearchParams();
    queryParams.set('limit', '100');

    if (searchTerm) {
      queryParams.set('name__icontains', searchTerm);
    }

    const endpoint = `/cms/v3/blogs/tags?${queryParams.toString()}`;
    logger.info('Fetching blog tags', { searchTerm });

    return this.request<PaginatedResponse<BlogTag>>(endpoint, { method: 'GET' });
  }

  /**
   * Generate a preview URL for draft content
   * Input: post_id or page_id
   * Output: Preview URL for review
   * Implementation: Construct preview URL with domain + slug + preview token
   * Purpose: Enable human review before publication
   */
  async getDraftPreviewUrl(
    params: PreviewUrlParams
  ): Promise<HubSpotResponse<{ previewUrl: string }>> {
    logger.info('Generating preview URL', { contentId: params.contentId, contentType: params.contentType });

    // First, fetch the content to get the URL and preview key
    let content: BlogPost | undefined;

    if (params.contentType === 'blog-post') {
      const response = await this.getBlogPost(params.contentId);
      if (!response.success || !response.data) {
        return {
          success: false,
          error: response.error || {
            status: 'NOT_FOUND',
            message: 'Failed to fetch content for preview URL generation',
            correlationId: 'N/A'
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }
      content = response.data;
    } else {
      // For pages, we would need to implement page fetching
      // For now, return an error for unsupported content types
      return {
        success: false,
        error: {
          status: 'NOT_IMPLEMENTED',
          message: 'Preview URL generation for pages is not yet implemented. Only blog-post is supported.',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    // Construct preview URL
    let previewUrl: string;
    if (content.url) {
      // Add preview key if available, otherwise use generic preview parameter
      const previewParam = content.previewKey
        ? `?hs_preview=${content.previewKey}`
        : '?hsPreview=true';
      previewUrl = `${content.url}${previewParam}`;
    } else {
      return {
        success: false,
        error: {
          status: 'NO_URL',
          message: 'Content does not have a URL yet. Save the content first to generate a URL.',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    logger.info('Preview URL generated', { previewUrl });

    return {
      success: true,
      data: { previewUrl },
      rateLimitStatus: this.rateLimiter.getStatus()
    };
  }
}
