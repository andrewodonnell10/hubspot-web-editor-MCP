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
  PreviewUrlParams,
  Page,
  PageListParams,
  PageUpdateMetadata,
  Template,
  PageCreateParams,
  Widget,
  WidgetLocation,
  PageContentStructure,
  WidgetUpdateParams,
  WidgetAddParams,
  WidgetRemoveParams,
  WidgetReorderParams,
  PageContentUpdate,
  StructuralValidation
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

  // ========================================
  // Phase 3: Page management and advanced features
  // ========================================

  /**
   * List pages (site pages or landing pages) with filtering and pagination
   * Inputs: page_type (site-pages/landing-pages), state, template_path, domain
   * Output: Array of pages with id, name, slug, state, domain
   * Implementation: GET /cms/v3/pages/{pageType}
   */
  async listPages(
    params: PageListParams
  ): Promise<HubSpotResponse<PaginatedResponse<Page>>> {
    const queryParams = new URLSearchParams();

    // Add pagination
    if (params.limit) queryParams.set('limit', Math.min(params.limit, 100).toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());

    // Add filters
    if (params.state) queryParams.set('state', params.state);
    if (params.templatePath) queryParams.set('templatePath', params.templatePath);
    if (params.domain) queryParams.set('domain', params.domain);
    if (params.name) queryParams.set('name__icontains', params.name);
    if (params.created) queryParams.set('created__gt', params.created);
    if (params.updated) queryParams.set('updated__gt', params.updated);
    if (params.archivedInDashboard !== undefined) {
      queryParams.set('archivedInDashboard', params.archivedInDashboard.toString());
    }

    const endpoint = `/cms/v3/pages/${params.pageType}?${queryParams.toString()}`;
    logger.info('Listing pages', { pageType: params.pageType, filters: params });

    return this.request<PaginatedResponse<Page>>(endpoint, { method: 'GET' });
  }

  /**
   * Get complete page details
   * Input: page_id, page_type
   * Output: Full page object (WARNING: includes complex nested structures)
   * Implementation: GET /cms/v3/pages/{pageType}/{objectId}
   */
  async getPage(pageId: string, pageType: 'site-pages' | 'landing-pages'): Promise<HubSpotResponse<Page>> {
    logger.info('Fetching page', { pageId, pageType });
    return this.request<Page>(`/cms/v3/pages/${pageType}/${pageId}`, { method: 'GET' });
  }

  /**
   * Update page metadata using fetch-first pattern
   * CRITICAL: Explicitly excludes layoutSections, widgets, widgetContainers to prevent data loss
   * Only updates: name, slug, htmlTitle, metaDescription
   * Inputs: page_id, page_type, title, meta_description, slug
   * Output: Updated page draft
   * Implementation: Fetch → modify simple fields only → PATCH /draft
   * Safety: Explicitly excludes layoutSections, widgets, widgetContainers
   * Purpose: SEO optimization without layout risk
   */
  async updatePageMetadata(
    pageId: string,
    pageType: 'site-pages' | 'landing-pages',
    metadata: PageUpdateMetadata
  ): Promise<HubSpotResponse<Page>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting page metadata update with fetch-first pattern', { opId, pageId, pageType });

    // STEP 1: Fetch current state
    const currentResponse = await this.getPage(pageId, pageType);
    if (!currentResponse.success || !currentResponse.data) {
      logger.error('Failed to fetch current page state', { opId, pageId });
      return currentResponse;
    }

    const beforeState = currentResponse.data;
    logger.info('Fetched current page state', { opId, pageId });

    // STEP 2: Merge metadata (explicitly exclude nested structures)
    const updatedPage = {
      ...beforeState,
      ...metadata,
      // CRITICAL: Preserve all nested structures to prevent data loss
      widgets: beforeState.widgets,
      widgetContainers: beforeState.widgetContainers,
      layoutSections: beforeState.layoutSections
    };

    // STEP 3: PATCH to draft endpoint
    logger.info('Updating page draft with metadata', { opId, pageId });
    const response = await this.request<Page>(
      `/cms/v3/pages/${pageType}/${pageId}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify(updatedPage)
      }
    );

    if (response.success) {
      logger.logOperation(
        'update_page_metadata',
        { opId, pageId, pageType, metadata },
        beforeState,
        response.data
      );
    }

    return response;
  }

  /**
   * List available templates
   * Output: Array of templates with id, path, label, type
   * Implementation: GET /cms/v3/source-code/draft/metadata/templates
   */
  async listTemplates(): Promise<HubSpotResponse<{ results: Template[] }>> {
    logger.info('Fetching templates list');

    // Note: The actual endpoint structure may vary based on HubSpot API
    // This is a simplified version - in production you might need to paginate
    const endpoint = '/content/api/v2/templates';

    return this.request<{ results: Template[] }>(endpoint, { method: 'GET' });
  }

  /**
   * Create a new page from template
   * Inputs: name, template_path, slug, domain, title, meta_description
   * Output: Created page in draft state
   * Implementation: POST /cms/v3/pages/site-pages with minimal content
   *
   * IMPORTANT: templatePath must NOT include leading slash
   */
  async createPageFromTemplate(
    params: PageCreateParams,
    pageType: 'site-pages' | 'landing-pages' = 'site-pages'
  ): Promise<HubSpotResponse<Page>> {
    const opId = logger.getNextOperationId();
    logger.info('Creating page from template', { opId, params, pageType });

    // Build request body with DRAFT state
    const requestBody: any = {
      name: params.name,
      slug: params.slug,
      // CRITICAL: Do NOT include leading slash in templatePath
      templatePath: params.templatePath.replace(/^\//, ''),
      state: 'DRAFT'  // Always create as draft for safety
    };

    // Add optional fields
    if (params.domain) requestBody.domain = params.domain;
    if (params.htmlTitle) requestBody.htmlTitle = params.htmlTitle;
    if (params.metaDescription) requestBody.metaDescription = params.metaDescription;

    const response = await this.request<Page>(
      `/cms/v3/pages/${pageType}`,
      {
        method: 'POST',
        body: JSON.stringify(requestBody)
      }
    );

    if (response.success) {
      logger.logOperation(
        'create_page_from_template',
        { opId, params, pageType },
        undefined,
        response.data
      );
    }

    return response;
  }

  // ========================================
  // Phase 5: Safe webpage content and appearance editing
  // ========================================

  /**
   * Helper: Extract all widgets from a page's layoutSections
   * Returns a flat array of widgets with their locations
   */
  private extractWidgetsFromPage(page: Page): PageContentStructure {
    const widgets: PageContentStructure['widgets'] = [];
    const layoutSections: string[] = [];

    if (!page.layoutSections || typeof page.layoutSections !== 'object') {
      return {
        pageId: page.id,
        pageName: page.name,
        widgets: [],
        layoutSections: [],
        totalWidgets: 0
      };
    }

    // Iterate through all layout sections
    for (const [sectionName, section] of Object.entries(page.layoutSections)) {
      layoutSections.push(sectionName);

      if (!section || typeof section !== 'object' || !Array.isArray((section as any).rows)) {
        continue;
      }

      const rows = (section as any).rows;

      // Iterate through rows
      rows.forEach((row: any, rowIndex: number) => {
        if (!row.cells || !Array.isArray(row.cells)) {
          return;
        }

        // Iterate through columns/cells
        row.cells.forEach((cell: any, columnIndex: number) => {
          if (!cell.widgets || !Array.isArray(cell.widgets)) {
            return;
          }

          // Iterate through widgets
          cell.widgets.forEach((widget: any, widgetIndex: number) => {
            const hasHtmlContent = !!(widget.body && widget.body.html);
            const contentPreview = hasHtmlContent
              ? widget.body.html.substring(0, 100).replace(/<[^>]*>/g, '').trim()
              : undefined;

            widgets.push({
              id: widget.id || `widget-${sectionName}-${rowIndex}-${columnIndex}-${widgetIndex}`,
              name: widget.name || widget.type || 'Unnamed Widget',
              type: widget.type || 'unknown',
              location: {
                sectionName,
                rowIndex,
                columnIndex,
                widgetIndex
              },
              hasHtmlContent,
              hasStyles: !!(widget.styles && Object.keys(widget.styles).length > 0),
              hasParams: !!(widget.params && Object.keys(widget.params).length > 0),
              contentPreview
            });
          });
        });
      });
    }

    return {
      pageId: page.id,
      pageName: page.name,
      widgets,
      layoutSections,
      totalWidgets: widgets.length
    };
  }

  /**
   * Helper: Get widget at specific location
   */
  private getWidgetAtLocation(page: Page, location: WidgetLocation): Widget | null {
    try {
      const section = (page.layoutSections as any)[location.sectionName];
      if (!section || !section.rows) return null;

      const row = section.rows[location.rowIndex];
      if (!row || !row.cells) return null;

      const cell = row.cells[location.columnIndex];
      if (!cell || !cell.widgets) return null;

      const widget = cell.widgets[location.widgetIndex];
      return widget || null;
    } catch (error) {
      logger.error('Error getting widget at location', { location, error });
      return null;
    }
  }

  /**
   * Helper: Set widget at specific location
   */
  private setWidgetAtLocation(page: Page, location: WidgetLocation, widget: Widget): boolean {
    try {
      const section = (page.layoutSections as any)[location.sectionName];
      if (!section || !section.rows) return false;

      const row = section.rows[location.rowIndex];
      if (!row || !row.cells) return false;

      const cell = row.cells[location.columnIndex];
      if (!cell || !cell.widgets) return false;

      cell.widgets[location.widgetIndex] = widget;
      return true;
    } catch (error) {
      logger.error('Error setting widget at location', { location, error });
      return false;
    }
  }

  /**
   * Helper: Validate page structure integrity
   */
  private validatePageStructure(beforePage: Page, afterPage: Page): StructuralValidation {
    const beforeStructure = this.extractWidgetsFromPage(beforePage);
    const afterStructure = this.extractWidgetsFromPage(afterPage);

    const warnings: string[] = [];
    const errors: string[] = [];

    // Check widget count
    if (beforeStructure.totalWidgets !== afterStructure.totalWidgets) {
      warnings.push(
        `Widget count changed from ${beforeStructure.totalWidgets} to ${afterStructure.totalWidgets}`
      );
    }

    // Check section count
    if (beforeStructure.layoutSections.length !== afterStructure.layoutSections.length) {
      errors.push(
        `Layout section count changed from ${beforeStructure.layoutSections.length} to ${afterStructure.layoutSections.length}. This indicates structural damage.`
      );
    }

    // Check section names
    const beforeSections = new Set(beforeStructure.layoutSections);
    const afterSections = new Set(afterStructure.layoutSections);

    beforeSections.forEach(section => {
      if (!afterSections.has(section)) {
        errors.push(`Layout section "${section}" was removed`);
      }
    });

    afterSections.forEach(section => {
      if (!beforeSections.has(section)) {
        warnings.push(`Layout section "${section}" was added`);
      }
    });

    return {
      isValid: errors.length === 0,
      beforeWidgetCount: beforeStructure.totalWidgets,
      afterWidgetCount: afterStructure.totalWidgets,
      beforeSectionCount: beforeStructure.layoutSections.length,
      afterSectionCount: afterStructure.layoutSections.length,
      warnings,
      errors
    };
  }

  /**
   * Get page content structure
   * Returns a structured view of all widgets and their locations
   * Input: page_id, page_type
   * Output: PageContentStructure with widget locations and previews
   * Purpose: Discover what widgets exist and where they are located
   */
  async getPageContentStructure(
    pageId: string,
    pageType: 'site-pages' | 'landing-pages'
  ): Promise<HubSpotResponse<PageContentStructure>> {
    logger.info('Getting page content structure', { pageId, pageType });

    const pageResponse = await this.getPage(pageId, pageType);
    if (!pageResponse.success || !pageResponse.data) {
      return {
        success: false,
        error: pageResponse.error,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const structure = this.extractWidgetsFromPage(pageResponse.data);

    return {
      success: true,
      data: structure,
      rateLimitStatus: this.rateLimiter.getStatus()
    };
  }

  /**
   * Update widget content using fetch-first pattern
   * CRITICAL: Uses complete fetch-first pattern to preserve all page structure
   * Only modifies the targeted widget's HTML content, styles, or parameters
   * Inputs: page_id, page_type, location, html/styles/params
   * Output: Updated page draft with validation
   * Implementation: Fetch → locate widget → modify widget → validate structure → PATCH /draft
   * Safety: Validates complete structure is preserved
   * Purpose: Safe widget-level content editing
   */
  async updateWidgetContent(
    params: WidgetUpdateParams
  ): Promise<HubSpotResponse<{ page: Page; validation: StructuralValidation; previewUrl?: string }>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting widget content update with fetch-first pattern', {
      opId,
      pageId: params.pageId,
      pageType: params.pageType,
      location: params.location
    });

    // STEP 1: Fetch current state
    const currentResponse = await this.getPage(params.pageId, params.pageType);
    if (!currentResponse.success || !currentResponse.data) {
      logger.error('Failed to fetch current page state', { opId, pageId: params.pageId });
      return {
        success: false,
        error: currentResponse.error,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const beforePage = JSON.parse(JSON.stringify(currentResponse.data)); // Deep clone for comparison
    const updatedPage = currentResponse.data;
    logger.info('Fetched current page state', { opId, pageId: params.pageId });

    // STEP 2: Locate and update the specific widget
    const widget = this.getWidgetAtLocation(updatedPage, params.location);
    if (!widget) {
      return {
        success: false,
        error: {
          status: 'WIDGET_NOT_FOUND',
          message: `Widget not found at location: section="${params.location.sectionName}", row=${params.location.rowIndex}, column=${params.location.columnIndex}, widget=${params.location.widgetIndex}`,
          correlationId: String(opId)
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    // Update widget properties
    if (params.html !== undefined) {
      if (!widget.body) widget.body = {};
      widget.body.html = params.html;
      logger.info('Updated widget HTML content', { opId, widgetId: widget.id });
    }

    if (params.styles !== undefined) {
      widget.styles = { ...widget.styles, ...params.styles };
      logger.info('Updated widget styles', { opId, widgetId: widget.id });
    }

    if (params.params !== undefined) {
      widget.params = { ...widget.params, ...params.params };
      logger.info('Updated widget parameters', { opId, widgetId: widget.id });
    }

    // Set the updated widget back
    const setSuccess = this.setWidgetAtLocation(updatedPage, params.location, widget);
    if (!setSuccess) {
      return {
        success: false,
        error: {
          status: 'UPDATE_FAILED',
          message: 'Failed to update widget at specified location',
          correlationId: String(opId)
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    // STEP 3: Validate structure integrity
    const validation = this.validatePageStructure(beforePage, updatedPage);
    if (!validation.isValid) {
      logger.error('Structure validation failed', { opId, validation });
      return {
        success: false,
        error: {
          status: 'VALIDATION_FAILED',
          message: `Structure validation failed: ${validation.errors.join(', ')}`,
          correlationId: String(opId)
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    if (validation.warnings.length > 0) {
      logger.warn('Structure validation warnings', { opId, warnings: validation.warnings });
    }

    // STEP 4: PATCH to draft endpoint with complete page object
    logger.info('Updating page draft with modified widget', { opId, pageId: params.pageId });
    const response = await this.request<Page>(
      `/cms/v3/pages/${params.pageType}/${params.pageId}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify(updatedPage)
      }
    );

    if (!response.success) {
      logger.error('Failed to update page draft', { opId, error: response.error });
      return {
        success: false,
        error: response.error,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    // Generate preview URL
    const previewUrl = response.data?.url
      ? `${response.data.url}?hs_preview=${response.data.previewKey || 'draft'}`
      : undefined;

    logger.logOperation(
      'update_widget_content',
      { opId, pageId: params.pageId, location: params.location },
      beforePage,
      response.data
    );

    return {
      success: true,
      data: {
        page: response.data!,
        validation,
        previewUrl
      },
      rateLimitStatus: this.rateLimiter.getStatus()
    };
  }

  /**
   * Add a new widget to a page
   * CRITICAL: Uses complete fetch-first pattern
   * Inputs: page_id, page_type, location (without widgetIndex), widget details
   * Output: Updated page draft
   * Implementation: Fetch → add widget to cell → validate → PATCH /draft
   * Safety: Validates structure is preserved and widget count increased by 1
   */
  async addWidget(
    params: WidgetAddParams
  ): Promise<HubSpotResponse<{ page: Page; validation: StructuralValidation; widgetLocation: WidgetLocation }>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting add widget operation', { opId, pageId: params.pageId });

    // STEP 1: Fetch current state
    const currentResponse = await this.getPage(params.pageId, params.pageType);
    if (!currentResponse.success || !currentResponse.data) {
      return {
        success: false,
        error: currentResponse.error,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const beforePage = JSON.parse(JSON.stringify(currentResponse.data));
    const updatedPage = currentResponse.data;

    // STEP 2: Navigate to the target cell and add widget
    try {
      const section = (updatedPage.layoutSections as any)[params.location.sectionName];
      if (!section || !section.rows) {
        return {
          success: false,
          error: {
            status: 'SECTION_NOT_FOUND',
            message: `Layout section "${params.location.sectionName}" not found`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      const row = section.rows[params.location.rowIndex];
      if (!row || !row.cells) {
        return {
          success: false,
          error: {
            status: 'ROW_NOT_FOUND',
            message: `Row ${params.location.rowIndex} not found in section "${params.location.sectionName}"`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      const cell = row.cells[params.location.columnIndex];
      if (!cell) {
        return {
          success: false,
          error: {
            status: 'CELL_NOT_FOUND',
            message: `Column ${params.location.columnIndex} not found in row ${params.location.rowIndex}`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      // Initialize widgets array if it doesn't exist
      if (!cell.widgets) {
        cell.widgets = [];
      }

      // Create new widget
      const newWidget: Widget = {
        id: `widget-${Date.now()}`,
        name: params.widgetName,
        type: params.widgetType,
        body: params.html ? { html: params.html } : undefined,
        params: params.params || {},
        styles: params.styles || {}
      };

      // Add widget to the end of the cell's widgets array
      cell.widgets.push(newWidget);
      const widgetIndex = cell.widgets.length - 1;

      const widgetLocation: WidgetLocation = {
        sectionName: params.location.sectionName,
        rowIndex: params.location.rowIndex,
        columnIndex: params.location.columnIndex,
        widgetIndex
      };

      logger.info('Added new widget to page', { opId, widgetLocation, widgetId: newWidget.id });

      // STEP 3: Validate structure
      const validation = this.validatePageStructure(beforePage, updatedPage);

      // For adding widgets, we expect widget count to increase by 1
      if (validation.afterWidgetCount !== validation.beforeWidgetCount + 1) {
        logger.warn('Unexpected widget count after adding widget', {
          opId,
          expected: validation.beforeWidgetCount + 1,
          actual: validation.afterWidgetCount
        });
      }

      if (!validation.isValid) {
        return {
          success: false,
          error: {
            status: 'VALIDATION_FAILED',
            message: `Structure validation failed: ${validation.errors.join(', ')}`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      // STEP 4: PATCH to draft endpoint
      const response = await this.request<Page>(
        `/cms/v3/pages/${params.pageType}/${params.pageId}/draft`,
        {
          method: 'PATCH',
          body: JSON.stringify(updatedPage)
        }
      );

      if (!response.success) {
        return {
          success: false,
          error: response.error,
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      logger.logOperation(
        'add_widget',
        { opId, pageId: params.pageId, widgetLocation },
        beforePage,
        response.data
      );

      return {
        success: true,
        data: {
          page: response.data!,
          validation,
          widgetLocation
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    } catch (error) {
      logger.error('Error adding widget', { opId, error });
      return {
        success: false,
        error: {
          status: 'ADD_WIDGET_FAILED',
          message: `Failed to add widget: ${error instanceof Error ? error.message : 'Unknown error'}`,
          correlationId: String(opId)
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }
  }

  /**
   * Remove a widget from a page
   * CRITICAL: Uses complete fetch-first pattern
   * Inputs: page_id, page_type, location
   * Output: Updated page draft
   * Implementation: Fetch → remove widget from array → validate → PATCH /draft
   * Safety: Validates widget count decreased by exactly 1
   */
  async removeWidget(
    params: WidgetRemoveParams
  ): Promise<HubSpotResponse<{ page: Page; validation: StructuralValidation }>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting remove widget operation', { opId, pageId: params.pageId, location: params.location });

    // STEP 1: Fetch current state
    const currentResponse = await this.getPage(params.pageId, params.pageType);
    if (!currentResponse.success || !currentResponse.data) {
      return {
        success: false,
        error: currentResponse.error,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const beforePage = JSON.parse(JSON.stringify(currentResponse.data));
    const updatedPage = currentResponse.data;

    // STEP 2: Navigate to widget and remove it
    try {
      const section = (updatedPage.layoutSections as any)[params.location.sectionName];
      if (!section || !section.rows) {
        return {
          success: false,
          error: {
            status: 'SECTION_NOT_FOUND',
            message: `Layout section "${params.location.sectionName}" not found`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      const row = section.rows[params.location.rowIndex];
      if (!row || !row.cells) {
        return {
          success: false,
          error: {
            status: 'ROW_NOT_FOUND',
            message: `Row ${params.location.rowIndex} not found`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      const cell = row.cells[params.location.columnIndex];
      if (!cell || !cell.widgets) {
        return {
          success: false,
          error: {
            status: 'CELL_NOT_FOUND',
            message: `Column ${params.location.columnIndex} not found`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      if (params.location.widgetIndex >= cell.widgets.length) {
        return {
          success: false,
          error: {
            status: 'WIDGET_NOT_FOUND',
            message: `Widget index ${params.location.widgetIndex} out of bounds (total: ${cell.widgets.length})`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      // Remove the widget
      const removedWidget = cell.widgets.splice(params.location.widgetIndex, 1)[0];
      logger.info('Removed widget from page', { opId, widgetId: removedWidget.id });

      // STEP 3: Validate structure
      const validation = this.validatePageStructure(beforePage, updatedPage);

      // For removing widgets, we expect widget count to decrease by 1
      if (validation.afterWidgetCount !== validation.beforeWidgetCount - 1) {
        logger.warn('Unexpected widget count after removing widget', {
          opId,
          expected: validation.beforeWidgetCount - 1,
          actual: validation.afterWidgetCount
        });
      }

      if (!validation.isValid) {
        return {
          success: false,
          error: {
            status: 'VALIDATION_FAILED',
            message: `Structure validation failed: ${validation.errors.join(', ')}`,
            correlationId: String(opId)
          },
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      // STEP 4: PATCH to draft endpoint
      const response = await this.request<Page>(
        `/cms/v3/pages/${params.pageType}/${params.pageId}/draft`,
        {
          method: 'PATCH',
          body: JSON.stringify(updatedPage)
        }
      );

      if (!response.success) {
        return {
          success: false,
          error: response.error,
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      logger.logOperation(
        'remove_widget',
        { opId, pageId: params.pageId, location: params.location },
        beforePage,
        response.data
      );

      return {
        success: true,
        data: {
          page: response.data!,
          validation
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    } catch (error) {
      logger.error('Error removing widget', { opId, error });
      return {
        success: false,
        error: {
          status: 'REMOVE_WIDGET_FAILED',
          message: `Failed to remove widget: ${error instanceof Error ? error.message : 'Unknown error'}`,
          correlationId: String(opId)
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }
  }
}
