// src/data/blogItems.ts
export interface Author {
  name: string;
  bio: string;
  image: string;
  social: {
    github: string;
    linkedin: string;
    twitter: string;
  };
}

export interface BlogItemType {
  title: string;
  excerpt: string;
  image: string;
  url: string;
  date: string;
  category: string;
  tags: string[];
  slug: string;
  content: string;
  author: Author;
  readTime: string;
  relatedPosts: string[];
}

const defaultAuthor: Author = {
  "name": "Weiguang Li",
  "bio": "Java Backend Engineer specializing in Spring Boot, distributed systems, and microservices. Passionate about clean code and continuous learning.",
  "image": "/img/profile-avatar.png",
  "social": {
    "github": "https://github.com/OiPunk",
    "linkedin": "https://linkedin.com/in/",
    "twitter": "https://twitter.com/"
  }
};

export const blogItems: BlogItemType[] = [
  {
    title: "Fixing a Silent Notion Sync Failure in Dify",
    excerpt: "How a one-line serialization regression broke Notion sync for all Dify v1.13.0 self-hosted users, and how I traced it through a masking test fixture to deliver a clean fix with regression coverage.",
    image: '/img/dify-notion-sync-bug.svg',
    url: '/blog/2026-03-01-dify-notion-sync-32705',
    date: 'March 1, 2026',
    category: 'Open Source',
    tags: ["Dify", "Python", "PostgreSQL", "psycopg2", "Notion", "Open Source"],
    slug: '2026-03-01-dify-notion-sync-32705',
    content: `
<h1>Fixing a Silent Notion Sync Failure in Dify</h1>
<p>This post covers my merged contribution to <a href="https://github.com/langgenius/dify" target="_blank" rel="noopener noreferrer">Dify</a>, a popular open-source LLM application platform. The fix addressed a critical regression that silently broke Notion knowledge-base synchronization for all self-hosted v1.13.0 users.</p>

<h2>Primary References</h2>
<ul>
  <li><strong>Issue:</strong> <a href="https://github.com/langgenius/dify/issues/32705" target="_blank" rel="noopener noreferrer">langgenius/dify#32705</a></li>
  <li><strong>Pull Request:</strong> <a href="https://github.com/langgenius/dify/pull/32747" target="_blank" rel="noopener noreferrer">langgenius/dify#32747</a></li>
  <li><strong>Regression source:</strong> <a href="https://github.com/langgenius/dify/pull/32129" target="_blank" rel="noopener noreferrer">langgenius/dify#32129</a> (DB session refactor)</li>
  <li><strong>Main source file:</strong> <a href="https://github.com/langgenius/dify/blob/main/api/tasks/document_indexing_sync_task.py" target="_blank" rel="noopener noreferrer">document_indexing_sync_task.py</a></li>
</ul>

<h2>Bug Flow Overview</h2>
<figure>
  <img src="/img/dify-notion-sync-bug.svg" alt="Dify Notion Sync Bug — data flow diagram showing how a raw dict caused psycopg2 ProgrammingError and how json.dumps fixed it" class="my-4" />
  <figcaption>Top: the broken data path in v1.13.0. Middle: the fixed path after <a href="https://github.com/langgenius/dify/pull/32747" target="_blank" rel="noopener noreferrer">PR #32747</a>. Bottom: why the existing test suite missed it.</figcaption>
</figure>

<h2>Background</h2>
<p>Dify allows users to connect external knowledge sources — including Notion — as retrieval-augmented context for LLM applications. When a Notion page is modified, users click "Sync" in the Dify dashboard to pull the latest content into their knowledge base.</p>
<p>After upgrading to v1.13.0, self-hosted users reported that the sync button appeared to finish instantly, but the content was never updated. No user-facing error was shown — the failure was completely silent. (See <a href="https://github.com/langgenius/dify/issues/32705" target="_blank" rel="noopener noreferrer">Issue #32705</a> for the original bug report.)</p>

<h2>The Symptom</h2>
<p>In the Docker worker logs, the real error was buried:</p>
<pre><code class="language-text">sqlalchemy.exc.ProgrammingError: (psycopg2.ProgrammingError) can't adapt type 'dict'</code></pre>
<p>This told me that somewhere in the sync task, a Python <code>dict</code> was being written directly to a PostgreSQL text column — and psycopg2 does not know how to serialize a dict to a text field.</p>

<h2>Root Cause Analysis</h2>
<p>The bug was a classic serialization regression. In the <code>document_indexing_sync_task</code>, after detecting that a Notion page had changed, the task reads metadata, updates a timestamp, and writes it back:</p>

<pre><code class="language-python"># The broken code path
data_source_info = document.data_source_info_dict   # returns a Python dict
data_source_info["last_edited_time"] = last_edited_time
document.data_source_info = data_source_info         # ← raw dict to LongText column</code></pre>

<p>The <code>data_source_info</code> column is a <code>LongText</code> field in the database. It stores JSON as a plain string, not as a native JSON type. Assigning a Python <code>dict</code> directly to this column causes psycopg2 to reject it at commit time.</p>

<p>This regression was introduced in <a href="https://github.com/langgenius/dify/pull/32129" target="_blank" rel="noopener noreferrer">PR #32129</a>, which refactored the sync task to use split database sessions. During the refactor, the original <code>json.dumps()</code> call was accidentally dropped. You can see <a href="https://github.com/langgenius/dify/pull/32747/files" target="_blank" rel="noopener noreferrer">the full diff of my fix here</a>.</p>

<h2>The Masking Test Fixture</h2>
<p>What made this bug especially interesting was that the existing integration tests did not catch it. Why?</p>
<p>The test suite included an <code>autouse</code> fixture that globally registered a psycopg2 adapter to convert <code>dict</code> objects to JSON:</p>

<pre><code class="language-python"># This fixture was HIDING the bug
@pytest.fixture(autouse=True)
def _register_dict_adapter_for_psycopg2():
    """Align test DB adapter behavior with dict payloads used in task update flow."""
    register_adapter(dict, Json)</code></pre>

<p>With this fixture active, psycopg2 could silently accept a raw dict — so the tests passed even though the production code path would fail. The fixture was essentially a workaround that masked the real serialization contract violation.</p>

<h2>The Fix</h2>
<p>The code fix itself was a single line:</p>

<pre><code class="language-python"># Before
document.data_source_info = data_source_info

# After
document.data_source_info = json.dumps(data_source_info)</code></pre>

<p>This is consistent with every other <code>data_source_info</code> write in the entire Dify codebase. The regression was simply a missed serialization call during refactoring.</p>

<h2>Test Changes</h2>
<p>Beyond the one-line fix, I made two important test changes:</p>

<h3>1. Removed the masking fixture</h3>
<p>I deleted the <code>_register_dict_adapter_for_psycopg2</code> autouse fixture from the integration tests. This ensures that if a similar regression is introduced in the future, the tests will catch it immediately rather than silently adapting around it.</p>

<h3>2. Added a regression unit test</h3>
<p>I added <code>TestDataSourceInfoSerialization</code> with a test that exercises the full sync flow and explicitly asserts that <code>data_source_info</code> is a JSON string, not a dict:</p>

<pre><code class="language-python">def test_data_source_info_serialized_as_json_string(self, ...):
    """data_source_info must be serialized with json.dumps before DB write."""
    # ... setup mocks for the full sync flow ...

    document_indexing_sync_task(dataset_id, document_id)

    # Assert: must be a JSON string, not a dict
    assert isinstance(mock_document.data_source_info, str)
    parsed = json.loads(mock_document.data_source_info)
    assert parsed["last_edited_time"] == "2024-02-01T00:00:00Z"</code></pre>

<h2>Validation</h2>
<pre><code class="language-bash"># Lint and format checks
ruff check
ruff format --check

# Unit tests (4/4 passed)
pytest api/tests/unit_tests/tasks/test_document_indexing_sync_task.py -v</code></pre>

<h2>Review and Merge</h2>
<p>The <a href="https://github.com/langgenius/dify/pull/32747" target="_blank" rel="noopener noreferrer">PR</a> was reviewed and approved by <a href="https://github.com/crazywoola" target="_blank" rel="noopener noreferrer">@crazywoola</a>, a Dify core maintainer, and <a href="https://github.com/langgenius/dify/pull/32747" target="_blank" rel="noopener noreferrer">merged on March 1, 2026</a>. The patch scope was intentionally small — one functional line, one removed fixture, one added test — to minimize review burden and merge risk.</p>

<h2>Lessons Learned</h2>
<ul>
  <li><strong>Test fixtures can hide bugs.</strong> An <code>autouse</code> fixture that globally adapts types may keep tests green while production code is broken. Be suspicious of any fixture that modifies runtime adapter behavior.</li>
  <li><strong>Serialization boundaries deserve explicit tests.</strong> When data crosses from Python objects to database columns, the serialization format should be asserted directly, not just the data content.</li>
  <li><strong>Refactoring regressions are predictable.</strong> When code is restructured (like splitting DB sessions), serialization and type-conversion calls at data boundaries are the most likely casualties. These deserve targeted review attention during refactors.</li>
  <li><strong>Silent failures are expensive.</strong> This bug produced no user-facing error — the sync just silently did nothing. Adding observability (logging, metrics) around task completion would help surface these failures faster.</li>
</ul>

<h2>Impact</h2>
<ul>
  <li><strong>Users affected:</strong> all self-hosted Dify v1.13.0 users with Notion knowledge bases.</li>
  <li><strong>Severity:</strong> data sync was completely broken, not degraded.</li>
  <li><strong>Fix scope:</strong> minimal and surgical — one line of code, zero risk of side effects.</li>
  <li><strong>Testing improvement:</strong> removed a masking fixture and added a direct regression test, making the codebase more honest.</li>
</ul>

<h2>Takeaway</h2>
<p>The best open-source contributions often come from following a production error to its root cause, then fixing not just the code but also the testing gap that allowed it to ship. This PR is a good example: a one-line fix paired with a testing cleanup that makes the project more robust going forward.</p>
`,
    author: defaultAuthor,
    readTime: '10 min read',
    relatedPosts: ['2026-02-26-langchain4j-vertexai-schema-interop', '2026-02-25-langchain4j-mcp-transport-compatibility'],
  },
  {
    title: "Fixing Vertex AI Gemini Tool-Schema Interop in LangChain4j",
    excerpt: "A practical deep dive into merged PR #4625: how a JSON schema compatibility gap broke tool calling for Vertex AI Gemini, and how I fixed it with focused regression coverage.",
    image: '/img/blog5.jpg',
    url: '/blog/2026-02-26-langchain4j-vertexai-schema-interop',
    date: 'February 26, 2026',
    category: 'Open Source',
    tags: ["LangChain4j", "Vertex AI", "Gemini", "Java", "JSON Schema", "Tool Calling"],
    slug: '2026-02-26-langchain4j-vertexai-schema-interop',
    content: `
<h1>Fixing Vertex AI Gemini Tool-Schema Interop in LangChain4j</h1>
<p>This post breaks down one of my recently merged open-source fixes in LangChain4j, focused on tool-schema compatibility with Vertex AI Gemini.</p>

<h2>Primary References</h2>
<ul>
  <li><strong>Issue:</strong> <a href="https://github.com/langchain4j/langchain4j/issues/4617" target="_blank" rel="noopener noreferrer">langchain4j/langchain4j#4617</a></li>
  <li><strong>Pull Request:</strong> <a href="https://github.com/langchain4j/langchain4j/pull/4625" target="_blank" rel="noopener noreferrer">langchain4j/langchain4j#4625</a></li>
  <li><strong>Merged commit:</strong> <a href="https://github.com/langchain4j/langchain4j/commit/c825b43b351abb71faf0fa5ff608fa32c04ea003" target="_blank" rel="noopener noreferrer">c825b43b351abb71faf0fa5ff608fa32c04ea003</a></li>
  <li><strong>Main implementation file:</strong> <a href="https://github.com/langchain4j/langchain4j/blob/main/langchain4j-vertex-ai-gemini/src/main/java/dev/langchain4j/model/vertexai/SchemaHelper.java" target="_blank" rel="noopener noreferrer">SchemaHelper.java</a></li>
  <li><strong>Regression tests:</strong> <a href="https://github.com/langchain4j/langchain4j/blob/main/langchain4j-vertex-ai-gemini/src/test/java/dev/langchain4j/model/vertexai/SchemaHelperTest.java" target="_blank" rel="noopener noreferrer">SchemaHelperTest.java</a></li>
</ul>

<h2>Background</h2>
<p>The bug appeared in a critical runtime path: converting internal tool parameter schemas into provider-specific schemas for Vertex AI Gemini function calling.</p>
<p>When the conversion logic encountered <code>JsonAnyOfSchema</code> or <code>JsonNullSchema</code>, it failed with errors such as <code>Unknown type: JsonAnyOfSchema</code>. In practical terms, tool calling could break before the model even executed the function.</p>

<h2>Why This Was Important</h2>
<ul>
  <li>It blocked real tool-calling workflows for valid JSON schema shapes.</li>
  <li>It was not a cosmetic issue; it was a runtime interop failure.</li>
  <li>It affected a high-value integration path: enterprise Java apps using LangChain4j with Vertex AI Gemini.</li>
</ul>

<h2>Root Cause</h2>
<p>The schema mapping code handled common schema node types, but it did not cover all constructs required by modern tool definitions, especially union-like and nullable shapes.</p>
<p>That meant the pipeline was correct only for a subset of schemas, which is fragile in production systems where schema expressiveness grows over time.</p>

<h2>The Fix</h2>
<p>I updated the schema conversion layer to support both <code>anyOf</code> and <code>null</code> schema elements, while preserving existing behavior for already-supported types.</p>

<h3>Simplified mapping idea</h3>
<pre><code class="language-java">// Simplified shape of the merged behavior
if (schema instanceof JsonAnyOfSchema anyOfSchema) {
    return mapAnyOf(anyOfSchema);
}

if (schema instanceof JsonNullSchema) {
    return mapNullType();
}

return mapExistingTypes(schema);</code></pre>

<p>The key point is not just adding branches. The change had to preserve backward compatibility and keep generated schemas valid for Vertex AI Gemini function declarations.</p>

<h2>Validation and Regression Coverage</h2>
<p>I added focused tests in <code>SchemaHelperTest</code> to ensure the mapping works for the new paths and does not regress existing behavior.</p>

<h3>Validation command used locally</h3>
<pre><code class="language-bash">./mvnw -pl langchain4j-vertex-ai-gemini -am \
  -Dtest=SchemaHelperTest \
  -Dsurefire.failIfNoSpecifiedTests=false test</code></pre>

<p>I also ran style and quality gates before submission so maintainers could review logic directly without formatting noise.</p>

<h2>Review Iteration</h2>
<p>The PR went through normal maintainer review flow: scope checks, correctness checks, and test sufficiency checks. Keeping the patch small and test-backed was the reason it moved quickly to merge.</p>

<h2>Impact and Value</h2>
<ul>
  <li><strong>Technical impact:</strong> fixes a real interop gap in a core provider integration path.</li>
  <li><strong>Product impact:</strong> reduces hard runtime failures in tool-enabled Gemini workflows.</li>
  <li><strong>Engineering signal:</strong> demonstrates issue triage, minimal-risk implementation, and regression-driven delivery in a top Java AI framework.</li>
</ul>

<h2>Takeaway</h2>
<p>High-value open-source contributions are often not massive rewrites. They are precise fixes in critical paths, with clear tests and clear communication. This PR is a good example of that pattern.</p>
`,
    author: defaultAuthor,
    readTime: '12 min read',
    relatedPosts: ['2026-02-25-langchain4j-mcp-transport-compatibility', '2026-02-17-rag-practical-guide'],
  },
  {
    title: "How I Fixed a Core MCP Transport Compatibility Bug in LangChain4j",
    excerpt: "A deep technical breakdown of merged PR #4584 in langchain4j: protocol negotiation failures, transport-level design tradeoffs, and a production-safe fix with regression tests.",
    image: '/img/blog6.jpg',
    url: '/blog/2026-02-25-langchain4j-mcp-transport-compatibility',
    date: 'February 25, 2026',
    category: 'Open Source',
    tags: ["LangChain4j", "MCP", "Java", "HTTP", "Open Source"],
    slug: '2026-02-25-langchain4j-mcp-transport-compatibility',
    content: `
<h1>How I Fixed a Core MCP Transport Compatibility Bug in LangChain4j</h1>
<p>This is a technical retrospective of one of my merged open-source contributions in the LangChain4j core MCP client path.</p>

<h2>Primary References</h2>
<ul>
  <li><strong>Issue:</strong> <a href="https://github.com/langchain4j/langchain4j/issues/4582" target="_blank" rel="noopener noreferrer">langchain4j/langchain4j#4582</a></li>
  <li><strong>Pull Request:</strong> <a href="https://github.com/langchain4j/langchain4j/pull/4584" target="_blank" rel="noopener noreferrer">langchain4j/langchain4j#4584</a></li>
  <li><strong>Merged commit:</strong> <a href="https://github.com/langchain4j/langchain4j/commit/88486da56c7b56d2833c76a1a9748d897ffebf35" target="_blank" rel="noopener noreferrer">88486da56c7b56d2833c76a1a9748d897ffebf35</a></li>
  <li><strong>Main source file:</strong> <a href="https://github.com/langchain4j/langchain4j/blob/main/langchain4j-mcp/src/main/java/dev/langchain4j/mcp/client/transport/http/StreamableHttpMcpTransport.java" target="_blank" rel="noopener noreferrer">StreamableHttpMcpTransport.java</a></li>
  <li><strong>Test file:</strong> <a href="https://github.com/langchain4j/langchain4j/blob/main/langchain4j-mcp/src/test/java/dev/langchain4j/mcp/client/transport/StreamableHttpMcpTransportTest.java" target="_blank" rel="noopener noreferrer">StreamableHttpMcpTransportTest.java</a></li>
</ul>

<h2>Background</h2>
<p>The issue looked small at first glance, but it sat on a high-leverage path: MCP stream transport initialization. If transport negotiation fails or hangs, the agent runtime cannot reliably discover tools or complete startup flows.</p>
<p>The failure mode was tied to protocol negotiation behavior across heterogeneous MCP server implementations and proxies. In practical terms, this created intermittent incompatibility for streamable HTTP MCP sessions.</p>

<h2>What Was Broken</h2>
<p>During transport setup, HTTP version behavior could become environment-sensitive. Some server setups did not behave consistently under upgrade/negotiation paths, causing stream sessions to become fragile.</p>
<p>This kind of bug is expensive in production because it appears as downstream instability: users see flaky tool calls, while logs often only show generic transport errors.</p>

<h2>Design Goals for the Fix</h2>
<ul>
  <li>Keep default behavior safe for the majority path.</li>
  <li>Retain explicit configurability for edge deployments.</li>
  <li>Avoid unnecessary public API leakage of low-level JDK HTTP details.</li>
  <li>Add regression tests directly at the transport boundary.</li>
</ul>

<h2>Implementation (with Source Links)</h2>
<p>The final merged change set evolved through several review rounds and API-shape refinements. Two representative commits from that process:</p>
<ul>
  <li><a href="https://github.com/langchain4j/langchain4j/commit/7c3388df971402a40c74996e348c8ec5d2648d05" target="_blank" rel="noopener noreferrer">7c3388d - force HTTP/1.1 for streamable HTTP transport (initial fix)</a></li>
  <li><a href="https://github.com/langchain4j/langchain4j/commit/108e3cca56e19cfb31b0a324bc818924a296cb7e" target="_blank" rel="noopener noreferrer">108e3cc - default HTTP/2 with explicit HTTP/1.1 opt-in (review-driven refinement)</a></li>
</ul>

<h3>Core transport idea (simplified excerpt)</h3>
<pre><code class="language-java">// Simplified shape of the merged approach
HttpClient.Builder clientBuilder = HttpClient.newBuilder();

if (configuredVersion == HTTP_1_1) {
    clientBuilder.version(HttpClient.Version.HTTP_1_1);
} else {
    clientBuilder.version(HttpClient.Version.HTTP_2);
}

HttpClient client = clientBuilder.build();</code></pre>

<h3>Caller-side opt-in pattern (simplified)</h3>
<pre><code class="language-java">StreamableHttpMcpTransport transport = StreamableHttpMcpTransport.builder()
        .baseUri(serverUri)
        .setHttpVersion1_1() // explicit downgrade when server requires it
        .build();</code></pre>

<h2>Regression Test Strategy</h2>
<p>I added and updated tests around transport version behavior so future changes cannot silently regress interoperability.</p>

<h3>Test intent (simplified)</h3>
<pre><code class="language-java">@Test
void shouldApplyConfiguredHttpVersionForStreamableTransport() {
    StreamableHttpMcpTransport transport = StreamableHttpMcpTransport.builder()
            .baseUri(URI.create("http://localhost:8080/mcp"))
            .setHttpVersion1_1()
            .build();

    assertThat(extractHttpClientVersion(transport)).isEqualTo(HttpClient.Version.HTTP_1_1);
}</code></pre>

<h2>Validation and CI</h2>
<p>Validation used module-scoped tests and format gates, then repeated verification after each maintainer feedback round:</p>
<pre><code class="language-bash">./mvnw -pl langchain4j-mcp,langchain4j-http-client -am \
  -Dtest=StreamableHttpMcpTransportTest \
  -Dsurefire.failIfNoSpecifiedTests=false test</code></pre>
<p>I also addressed style gate failures (Spotless) in the same PR to keep the merge path clean.</p>

<h2>Why This PR Is High Value</h2>
<ul>
  <li><strong>Scope:</strong> core runtime compatibility, not a cosmetic patch.</li>
  <li><strong>Impact:</strong> directly improves MCP transport reliability across environments.</li>
  <li><strong>Engineering quality:</strong> review-driven API refinement plus targeted regression tests.</li>
  <li><strong>Career signal:</strong> demonstrates diagnosis, implementation, testing, and maintainer collaboration end-to-end.</li>
</ul>

<h2>Takeaway</h2>
<p>For open-source contributors targeting real engineering credibility, this is the pattern to pursue: pick a small but critical failure mode, keep the fix minimal and testable, and iterate fast with maintainers until merge.</p>
`,
    author: defaultAuthor,
    readTime: '14 min read',
    relatedPosts: ['2026-02-17-rag-practical-guide'],
  },
  {
    title: "RAG in Production: From Prototype to High-Trust AI",
    excerpt: "A practical, engineering-first guide to Retrieval-Augmented Generation covering architecture, chunking, hybrid retrieval, prompt grounding, and evaluation loops.",
    image: '/img/rag-cover.svg',
    url: '/rag-production-guide',
    date: 'February 17, 2026',
    category: 'AI',
    tags: ["RAG", "LLM", "Vector Search", "AI Engineering"],
    slug: '2026-02-17-rag-practical-guide',
    content: `
<h1>RAG in Production: From Prototype to High-Trust AI</h1>
<p>Large language models are impressive, but raw generation alone is not enough for production systems. In business settings, users need answers that are current, source-grounded, and auditable. This is exactly where Retrieval-Augmented Generation (RAG) becomes a core architecture rather than an optional add-on.</p>
<p>In this article, we will walk through RAG from first principles to production trade-offs. The goal is simple: keep the explanation accessible while giving enough engineering depth to ship confidently.</p>

<figure>
  <img src="/img/rag-cover.svg" alt="RAG architecture overview" class="my-4" />
  <figcaption>RAG combines retrieval quality, prompt design, and evaluation discipline.</figcaption>
</figure>

<h2>1. Why RAG Exists</h2>
<p>A standalone LLM has three common limitations in real-world products:</p>
<ul>
  <li><strong>Knowledge staleness</strong>: model parameters do not automatically include your latest internal docs.</li>
  <li><strong>Hallucination risk</strong>: confident but unsupported statements can damage trust quickly.</li>
  <li><strong>Weak traceability</strong>: teams cannot easily verify where an answer came from.</li>
</ul>
<p>RAG addresses these by injecting relevant external context at inference time. Instead of asking the model to guess, we ask it to reason over retrieved evidence.</p>

<h2>2. Mental Model: RAG Is a Data System, Not Just a Prompt Trick</h2>
<p>A common beginner mistake is to treat RAG as “vector search + one prompt template”. In production, RAG is better modeled as a data and feedback system with distinct stages:</p>
<ol>
  <li>Ingest and normalize source documents.</li>
  <li>Chunk content into retrieval-friendly units.</li>
  <li>Embed and index chunks for fast candidate recall.</li>
  <li>Retrieve and rerank context for each query.</li>
  <li>Generate an answer with citations and policy constraints.</li>
  <li>Evaluate outcomes and feed failures back into the pipeline.</li>
</ol>

<figure>
  <img src="/img/rag-pipeline.svg" alt="RAG pipeline lifecycle" class="my-4" />
  <figcaption>A production RAG lifecycle from ingestion to measurable quality control.</figcaption>
</figure>

<h2>3. Chunking Strategy: The First Big Quality Lever</h2>
<p>Most RAG quality issues start before retrieval, at chunking time. If chunks are too short, semantic meaning is fragmented. If chunks are too long, relevance ranking degrades and context windows are wasted.</p>
<p>Practical guidance:</p>
<ul>
  <li>Use structure-aware splitting when possible (headings, sections, code blocks).</li>
  <li>Use overlap conservatively to preserve continuity at boundaries.</li>
  <li>Store rich metadata (source, timestamp, section title, permissions).</li>
  <li>Preserve a canonical document link for every chunk.</li>
</ul>
<p>A robust default for knowledge-heavy text is to start with semantic chunks around a few hundred tokens, then tune using retrieval metrics rather than intuition.</p>

<h2>4. Retrieval Design: Dense + Sparse + Reranking</h2>
<p>Dense retrieval captures semantic similarity well, but lexical retrieval is still strong for exact terms, codes, and identifiers. In practice, hybrid retrieval often wins:</p>
<ul>
  <li><strong>Dense retrieval</strong> for concept-level matching.</li>
  <li><strong>Sparse/BM25 retrieval</strong> for exact keyword precision.</li>
  <li><strong>Reranker</strong> to reorder top candidates by cross-encoding relevance.</li>
</ul>
<p>This pattern improves both recall and final answer precision, especially in domains with mixed natural language and structured jargon.</p>

<h3>Example retrieval flow</h3>
<pre><code>query -> hybrid retrieve (k=40)
      -> metadata/permission filter
      -> rerank top 40 -> keep top 6
      -> prompt assembly with source attributions</code></pre>

<h2>5. Prompt Grounding: Make the Model Use Evidence, Not Improvise</h2>
<p>Even with good retrieval, weak prompting can still produce unsupported answers. Your generation prompt should explicitly define behavior:</p>
<ul>
  <li>Answer only from provided context.</li>
  <li>Cite sources per claim (or per paragraph).</li>
  <li>Admit uncertainty when evidence is insufficient.</li>
  <li>Prefer concise, faithful synthesis over speculation.</li>
</ul>
<p>For higher-stakes workflows, enforce citation checks in post-processing and reject unsupported outputs.</p>

<h2>6. Evaluation: The Difference Between Demo and Product</h2>
<p>RAG quality does not improve sustainably without an evaluation loop. Track both retrieval and generation metrics, and keep a curated benchmark set that reflects real user questions.</p>

<figure>
  <img src="/img/rag-eval-loop.svg" alt="RAG evaluation loop diagram" class="my-4" />
  <figcaption>Measure, diagnose, and iterate. Reliability emerges from repeated evaluation cycles.</figcaption>
</figure>

<h3>Recommended metric categories</h3>
<ul>
  <li><strong>Retrieval metrics</strong>: Recall@k, MRR, context precision.</li>
  <li><strong>Answer metrics</strong>: faithfulness, citation correctness, answer completeness.</li>
  <li><strong>Operational metrics</strong>: p95 latency, cost per answer, timeout rate.</li>
  <li><strong>Safety metrics</strong>: hallucination rate, policy violation rate.</li>
</ul>

<h2>7. Common Failure Modes and Fixes</h2>
<h3>Failure 1: “The answer sounds right but cites the wrong source.”</h3>
<p><strong>Fix:</strong> improve reranking, reduce noisy chunk length, enforce citation validation rules.</p>

<h3>Failure 2: “The system misses obvious internal documents.”</h3>
<p><strong>Fix:</strong> improve ingestion freshness, add sparse retrieval, verify metadata filters are not over-restrictive.</p>

<h3>Failure 3: “Latency is too high at peak traffic.”</h3>
<p><strong>Fix:</strong> reduce candidate set, cache embeddings and frequent retrieval results, apply two-stage retrieval efficiently.</p>

<h3>Failure 4: “Quality drifts after document updates.”</h3>
<p><strong>Fix:</strong> run incremental re-indexing, add freshness tests, and keep versioned evaluation snapshots.</p>

<h2>8. A Practical Build Checklist</h2>
<ul>
  <li>Structured ingestion pipeline with document versioning.</li>
  <li>Chunk + metadata policy that is testable and deterministic.</li>
  <li>Hybrid retrieval with optional reranking.</li>
  <li>Prompt policy for grounding, refusal, and citation format.</li>
  <li>Offline benchmark + online telemetry dashboard.</li>
  <li>Incident workflow for hallucination reports and root-cause analysis.</li>
</ul>

<h2>Conclusion</h2>
<p>RAG is not a silver bullet, but it is currently one of the most practical architectures for building trustworthy AI assistants on private or rapidly changing knowledge. The teams that succeed with RAG are not the ones with the fanciest model; they are the ones that treat retrieval quality, prompt constraints, and evaluation rigor as first-class engineering concerns.</p>
<p>If you are starting today, begin simple, instrument everything, and iterate with evidence. That mindset scales much better than chasing one-shot prompt magic.</p>
`,
    author: defaultAuthor,
    readTime: '14 min read',
    relatedPosts: [],
  },
  {
    title: "Spring IoC Annotation Usage",
    excerpt: "Master Spring IoC annotation-based configuration including @Component, @Autowired, @Qualifier, and component scanning for enterprise applications.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-04-03-spring-ioc',
    date: 'April 3, 2020',
    category: 'Spring',
    tags: ["Framework","Spring","IOC"],
    slug: '2020-04-03-spring-ioc',
    content: `<p><h1>Spring IOC的注解使用</h1></p><p>​ 在之前的项目中-我们都是通过xml文件进行bean或者某些属性的赋值-其实还有另外一种注解的方式-在企业开发中使用的很多-在bean上添加注解-可以快速的将bean注册到ioc容器。</p><p><h3>1、使用注解的方式注册bean到IOC容器中</h3></p><p>applicationContext.xml</p><p>PersonController.java</p><p>\`\`<code>java
package com.oi.controller;import org.springframework.stereotype.Controller;@Controllerpublic class PersonController {    public PersonController() {        System.out.println("创建对象");    }}
</code>\`<code></p><p>PersonService.java</p><p></code>\`<code>java
package com.oi.service;import org.springframework.stereotype.Service;@Servicepublic class PersonService {}
</code>\`<code></p><p>PersonDao.java</p><p></code>\`<code>java
package com.oi.dao;import org.springframework.stereotype.Repository;@Repository("personDao")@Scope(value="prototype")public class PersonDao {}
</code>\`<code></p><p><h3>2、定义扫描包时要包含的类和不要包含的类</h3></p><p>​ 当定义好基础的扫描包后-在某些情况下可能要有选择性的配置是否要注册bean到IOC容器中-此时可以通过如下的方式进行配置。</p><p>applicationContext.xml</p><p><h3>3、使用@AutoWired进行自动注入</h3></p><p>​ 使用注解的方式实现自动注入需要使用@AutoWired注解。</p><p>PersonController.java</p><p></code>\`<code>java
package com.oi.controller;import com.oi.service.PersonService;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.stereotype.Controller;@Controllerpublic class PersonController {    @Autowired    private PersonService personService;    public PersonController() {        System.out.println("创建对象");    }    public void getPerson(){        personService.getPerson();    }}
</code>\`<code></p><p>PersonService.java</p><p></code>\`<code>java
package com.oi.service;import com.oi.dao.PersonDao;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.stereotype.Service;@Servicepublic class PersonService {    @Autowired    private PersonDao personDao;    public void getPerson(){        personDao.getPerson();    }}
</code>\`<code></p><p>PersonDao.java</p><p></code>\`<code>java
package com.oi.dao;        import org.springframework.stereotype.Repository;@Repositorypublic class PersonDao {    public void getPerson(){        System.out.println("PersonDao:getPerson");    }}
</code>\`<code></p><p>注意：当使用AutoWired注解的时候-自动装配的时候是根据类型实现的。</p><p>​ 1、如果只找到一个-则直接进行赋值-</p><p>​ 2、如果没有找到-则直接抛出异常-</p><p>​ 3、如果找到多个-那么会按照变量名作为id继续匹配,</p><p>​ 1、匹配上直接进行装配</p><p>​ 2、如果匹配不上则直接报异常</p><p>PersonServiceExt.java</p><p></code>\`<code>java
package com.oi.service;import com.oi.dao.PersonDao;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.stereotype.Service;@Servicepublic class PersonServiceExt extends PersonService{    @Autowired    private PersonDao personDao;    public void getPerson(){        System.out.println("PersonServiceExt......");        personDao.getPerson();    }}
</code>\`<code></p><p>PersonController.java</p><p></code>\`<code>java
package com.oi.controller;import com.oi.service.PersonService;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.stereotype.Controller;@Controllerpublic class PersonController {    @Autowired    private PersonService personServiceExt;    public PersonController() {        System.out.println("创建对象");    }    public void getPerson(){        personServiceExt.getPerson();    }}
</code>\`<code></p><p>​ 还可以使用@Qualifier注解来指定id的名称-让spring不要使用变量名,当使用@Qualifier注解的时候也会有两种情况：</p><p>​ 1、找到-则直接装配</p><p>​ 2、找不到-就会报错</p><p>PersonController.java</p><p></code>\`<code>java
package com.oi.controller;import com.oi.service.PersonService;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.beans.factory.annotation.Qualifier;import org.springframework.stereotype.Controller;@Controllerpublic class PersonController {    @Autowired    @Qualifier("personService")    private PersonService personServiceExt2;    public PersonController() {        System.out.println("创建对象");    }    public void getPerson(){        personServiceExt2.getPerson();    }}
</code>\`<code></p><p>​ 通过上述的代码我们能够发现-使用@AutoWired肯定是能够装配上的-如果装配不上就会报错。</p><p><h3>4、@AutoWired可以进行定义在方法上</h3></p><p>​ 当我们查看@AutoWired注解的源码的时候发现-此注解不仅可以使用在成员变量上-也可以使用在方法上。</p><p>PersonController.java</p><p></code>\`<code>java
package com.oi.controller;import com.oi.dao.PersonDao;import com.oi.service.PersonService;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.beans.factory.annotation.Qualifier;import org.springframework.stereotype.Controller;@Controllerpublic class PersonController {    @Qualifier("personService")    @Autowired    private PersonService personServiceExt2;    public PersonController() {        System.out.println("创建对象");    }    public void getPerson(){        System.out.println("personController..."+personServiceExt2);//        personServiceExt2.getPerson();    }     /<strong>     * 当方法上有@AutoWired注解时：     *  1、此方法在bean创建的时候会自动调用     *  2、这个方法的每一个参数都会自动注入值     * @param personDao     */    @Autowired    public void test(PersonDao personDao){        System.out.println("此方法被调用:"+personDao);    }        /</st`,
    author: defaultAuthor,
    readTime: '24 min read',
    relatedPosts: ["2020-05-22-ioc","2020-05-23-spring"],
  },
  {
    title: "MySQL Transaction Test Cases",
    excerpt: "Comprehensive test cases for MySQL transaction isolation levels covering dirty reads, non-repeatable reads, and phantom reads with practical SQL examples.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-05-03-mysql',
    date: 'May 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-05-03-mysql',
    content: `<p><h1>mysql事务测试</h1></p><p>1、打开mysql的命令行-将自动提交事务给关闭</p><p>\`\`<code>sql
--查看是否是自动提交 1表示开启-0表示关闭select @@autocommit;--设置关闭set autocommit = 0;
</code>\`<code></p><p>2、数据准备</p><p></code>\`<code>sql
--创建数据库create database tran;--切换数据库 两个窗口都执行use tran;--准备数据 create table psn(id int primary key,name varchar(10)) engine=innodb;--插入数据insert into psn values(1,'zhangsan');insert into psn values(2,'lisi');insert into psn values(3,'wangwu');commit;
</code>\`<code></p><p>3、测试事务</p><p></code>\`<code>sql
--事务包含四个隔离级别：从上往下-隔离级别越来越高-意味着数据越来越安全read uncommitted; 	--读未提交read commited;		--读已提交repeatable read;	--可重复读(seariable)			--序列化执行-串行执行--产生数据不一致的情况：脏读不可重复读幻读
</code>\`<code></p><p>隔离级别</p><p>异常情况</p><p>异常情况</p><p>读未提交</p><p>脏读</p><p>不可重复读</p><p>幻读</p><p>读已提交</p><p>不可重复读</p><p>幻读</p><p>可重复读</p><p>幻读</p><p>序列化</p><p>4、测试1：脏读 read uncommitted</p><p></code>\`<code>sql
set session transaction isolation level read uncommitted;A:start transaction;A:select * from psn;B:start transaction;B:select * from psn;A:update psn set name='msb';A:selecet * from psnB:select * from psn;  --读取的结果msb。产生脏读-因为A事务并没有commit-读取到了不存在的数据A:commit;B:select * from psn; --读取的数据是msb,因为A事务已经commit-数据永久的被修改
</code>\`<code></p><p>5、测试2：当使用read committed的时候-就不会出现脏读的情况了-当时会出现不可重复读的问题</p><p></code>\`<code>sql
set session transaction isolation level read committed;A:start transaction;A:select * from psn;B:start transaction;B:select * from psn;--执行到此处的时候发现-两个窗口读取的数据是一致的A:update psn set name ='zhangsan' where id = 1;A:select * from psn;B:select * from psn;--执行到此处发现两个窗口读取的数据不一致-B窗口中读取不到更新的数据A:commit;A:select * from psn;--读取到更新的数据B:select * from psn;--也读取到更新的数据--发现同一个事务中多次读取数据出现不一致的情况
</code>\`<code></p><p>6、测试3：当使用repeatable read的时候(按照上面的步骤操作)-就不会出现不可重复读的问题-但是会出现幻读的问题</p><p></code>\`<code>sql
set session transaction isolation level repeatable read;A:start transaction;A:select * from psn;B:start transaction;B:select * from psn;--此时两个窗口读取的数据是一致的A:insert into psn values(4,'sisi');A:commit;A:select * from psn;--读取到添加的数据B:select * from psn;--读取不到添加的数据B:insert into psn values(4,'sisi');--报错-无法插入数据--此时发现读取不到数据-但是在插入的时候不允许插入-出现了幻读-设置更高级别的隔离级别即可解决
</code>\`\`</p>`,
    author: defaultAuthor,
    readTime: '5 min read',
    relatedPosts: ["2020-06-13-mysql","2020-07-03-mysql"],
  },
  {
    title: "Java Memory Model (JMM)",
    excerpt: "Deep dive into Java Memory Model covering CPU cache coherence, MESI protocol, memory barriers, happens-before relationships, and volatile semantics.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-05-13-java',
    date: 'May 13, 2020',
    category: 'Java',
    tags: ["JVM","JMM","Memory"],
    slug: '2020-05-13-java',
    content: `<p><img src="/images/blog/image-20200406103106651.png" alt="illustration" class="my-4" /></p><p>离CPU越近, 速度越快, 空间越小</p><p><img src="/images/blog/image-20200406103208497.png" alt="illustration" class="my-4" /></p><p>数据不一致问题</p><p><img src="/images/blog/image-20200406103255933.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200406103528554.png" alt="illustration" class="my-4" /></p><p>缓存锁</p><p><img src="/images/blog/image-20200406103638477.png" alt="illustration" class="my-4" /></p><p>和主存内容比较  
Modified改过, 再加载 Exclusive独享 Shared我读的时候别人也在读 Invalid读时被别的CPU改过</p><p>现代CPU的数据一致性实现 = 缓存锁(MESI …) + 总线锁读取缓存以cache line为基本单位-目前64bytes</p><p>位于同一缓存行的两个不同数据-被两个不同CPU锁定-产生互相影响的伪共享问题</p><p>伪共享问题：JUC/c_028_FalseSharing</p><p>使用缓存行的对齐能够提高效率</p><p><img src="/images/blog/image-20200406105854481.png" alt="illustration" class="my-4" /></p><p>乱序问题</p><p><img src="/images/blog/image-20200406105951702.png" alt="illustration" class="my-4" /></p><p>CPU为了提高指令执行效率-会在一条指令执行过程中（比如去内存读数据（慢100倍））-去同时执行另一条指令-前提是-两条指令没有依赖关系</p><p>写操作也可以进行合并</p><p>乱序执行的证明：JVM/jmm/Disorder.java</p><p><h2>如何保证特定情况下不乱序</h2></p><p>硬件内存屏障 X86</p><p>> sfence: store| 在sfence指令前的写操作当必须在sfence指令后的写操作前完成。  
> lfence：load | 在lfence指令前的读操作当必须在lfence指令后的读操作前完成。  
> mfence：modify/mix | 在mfence指令前的读写操作当必须在mfence指令后的读写操作前完成。</p><p>> 原子指令-如x86上的”lock …” 指令是一个Full Barrier-执行时会锁住内存子系统来确保执行顺序-甚至跨多个CPU。Software Locks通常使用了内存屏障或原子指令来实现变量可见性和保持程序顺序</p><p>JVM级别如何规范（JSR133）</p><p>> LoadLoad屏障：  
> 对于这样的语句Load1; LoadLoad; Load2-
>
> \`\`<code>
> 在Load2及后续读取操作要读取的数据被访问前-保证Load1要读取的数据被读取完毕。
> </code>\`<code>
>
> StoreStore屏障：
>
> </code>\`<code>
> 对于这样的语句Store1; StoreStore; Store2-
>
> 在Store2及后续写入操作执行前-保证Store1的写入操作对其它处理器可见。
> </code>\`<code>
>
> LoadStore屏障：
>
> </code>\`<code>
> 对于这样的语句Load1; LoadStore; Store2-
>
> 在Store2及后续写入操作被刷出前-保证Load1要读取的数据被读取完毕。
> </code>\`<code>
>
> StoreLoad屏障：  
> 对于这样的语句Store1; StoreLoad; Load2-
>
> ​ 在Load2及后续所有读取操作执行前-保证Store1的写入对所有处理器可见。</p><p>volatile的实现细节</p><p><li> 字节码层面  </li>
    ACC_VOLATILE
<li> JVM层面  </li>
    volatile内存区的读写 都加屏障</p><p>    > StoreStoreBarrier
    >
    > volatile 写操作
    >
    > StoreLoadBarrier</p><p>    > LoadLoadBarrier
    >
    > volatile 读操作
    >
    > LoadStoreBarrier</p><p>    <img src="/images/blog/image-20200406133643178.png" alt="illustration" class="my-4" /></p><p><li> OS和硬件层面  </li>
    <a href="https://blog.csdn.net/qq_26222859/article/details/52235930">https://blog.csdn.net/qq_26222859/article/details/52235930</a>  
    hsdis - HotSpot Dis Assembler  
    windows lock 指令实现 | MESI实现</p><p>synchronized实现细节</p><p><li> 字节码层面  </li>
    ACC_SYNCHRONIZED  
    monitorenter monitorexit
<li> JVM层面  </li>
    C C++ 调用了操作系统提供的同步机制
<li> OS和硬件层面  </li>
    X86 : lock cmpxchg / xxx  
    <a href="https://blog.csdn.net/21aspnet/article/details/88571740">https</a><a href="https://blog.csdn.net/21aspnet/article/details/88571740">://blog.csdn.net/21aspnet/article/details/</a>\[88571740</p><p><img src="/images/blog/image-20200406141008614.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200406141654051.png" alt="illustration" class="my-4" /></p><p><h3>观察虚拟机配置</h3></p><p>java -XX:+PrintCommandLineFlags -version</p><p><h3>普通对象</h3></p><p><img src="/images/blog/NHM%5DW@6V4YDG05XD1M%5DB%60LR-1587785829438.png" alt="illustration" class="my-4" /></p><p><li> 对象头：markword 8</li>
<li> ClassPointer指针：-XX:+UseCompressedClassPointers 为4字节 不开启为8字节</li>
<li> 实例数据</li>
    1.  引用类型：-XX:+UseCompressedOops 为4字节 不开启为8字节  
        Oops Ordinary Object Pointers
<li> Padding对齐-8的倍数</li></p><p><h3>数组对象</h3></p><p><li> 对象头：markword 8</li>
<li> ClassPointer指针同上</li>
<li> 数组长度：4字节</li>
<li> 数组数据</li>
<li> 对齐 8的倍数</li></p><p><img src="/images/blog/image-20200406143814461.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200423213522378.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406144658888.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406144920389.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200406145146864.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200406145223522.png" alt="illustration" class="my-4" /></p><p>Heap</p><p>Method Area</p><p><li> Perm Space (<1.8)  </li>
    字符串常量位于PermSpace  
    FGC不会清理  
    大小启动的时候指定-不能变
<li> Meta Space (>=1.8)  </li>
    字符串常量位于堆  
    会触发FGC清理  
    不设定的话-最大就是物理内存</p><p>Runtime Constant Pool</p><p>Native Method Stack</p><p>Direct Memory</p><p>> JVM可以直接访问的内核空间的内存 (OS 管理的内存)
>
> NIO - 提高效率-实现zero copy</p><p>思考：</p><p>> 如何证明1.7字符串常量位于Perm-而1.8位于Heap？
>
> 提示：结合GC- 一直创建字符串常量-观察堆-和Metaspace</p><p>PC 程序计数器</p><p>> 存放指令位置
>
> 虚拟机的运行-类似于这样的循环：
>
> while( not end ) {
>
> ​ 取PC中的位置-找到对应位置的指令；
>
> ​ 执行该指令；
>
> ​ PC ++;
>
> }</p><p><img src="/images/blog/image-20200406145829843.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200406145851489.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200406145909`,
    author: defaultAuthor,
    readTime: '29 min read',
    relatedPosts: ["2020-06-23-gcjvm"],
  },
  {
    title: "IoC Container Basics",
    excerpt: "Complete guide to Spring IoC container basics including XML configuration, dependency injection, bean scopes, lazy loading, and autowiring strategies.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-05-22-ioc',
    date: 'May 22, 2020',
    category: 'Spring',
    tags: ["Framework","Spring","IOC"],
    slug: '2020-05-22-ioc',
    content: `<p><h1>Spring IOC基本使用</h1></p><p><h3>1、spring_helloworld</h3></p><p>##### <strong>(1)使用手动加载jar包的方式实现-分为三个步骤-现在几乎不用</strong></p><p><li><strong>导包：导入这五个包即可</strong></li></p><p>  commons-logging-1.2.jar  
  spring-beans-5.2.3.RELEASE.jar  
  spring-context-5.2.3.RELEASE.jar  
  spring-core-5.2.3.RELEASE.jar  
  spring-expression-5.2.3.RELEASE.jar</p><p><li><strong>写配置</strong></li></p><p>  Person.java</p><p>  \`\`<code>java
  package com.oi.bean;public class Person {    private int id;    private String name;    private int age;    private String gender;    public int getId() {        return id;    }    public void setId(int id) {        this.id = id;    }    public String getName() {        return name;    }    public void setName(String name) {        this.name = name;    }    public int getAge() {        return age;    }    public void setAge(int age) {        this.age = age;    }    public String getGender() {        return gender;    }    public void setGender(String gender) {        this.gender = gender;    }    @Override    public String toString() {        return "Person{" +                "id=" + id +                ", name='" + name + '\'' +                ", age=" + age +                ", gender='" + gender + '\'' +                '}';    }}
  </code>\`<code></p><p>  ioc.xml</p><p><li><strong>测试</strong></li></p><p>SpringDemoTest.java</p><p></code>\`<code>java
package com.oi.test;import com.oi.bean.Person;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;public class SpringDemoTest {    public static void main(String[] args) {        //ApplicationContext:表示ioc容器        //ClassPathXmlApplicationContext:表示从当前classpath路径中获取xml文件的配置        //根据spring的配置文件来获取ioc容器对象        ApplicationContext context = new ClassPathXmlApplicationContext("ioc.xml");        Person person = (Person) context.getBean("person");        System.out.println(person);    }}
</code>\`<code></p><p>##### <strong>(2)使用maven的方式来构建项目</strong></p><p><li><strong>创建maven项目</strong></li></p><p>  定义项目的groupId、artifactId</p><p><li><strong>添加对应的pom依赖</strong></li></p><p>  pom.xml</p><p>  </code>\`<code>xml
      4.0.0    com.oi    spring_demo    1.0-SNAPSHOT                                org.springframework            spring-context            5.2.3.RELEASE
  </code>\`<code></p><p><li><strong>编写代码</strong></li></p><p>  Person.java</p><p>  </code>\`<code>java
  package com.oi.bean;public class Person {    private int id;    private String name;    private int age;    private String gender;    public int getId() {        return id;    }    public void setId(int id) {        this.id = id;    }    public String getName() {        return name;    }    public void setName(String name) {        this.name = name;    }    public int getAge() {        return age;    }    public void setAge(int age) {        this.age = age;    }    public String getGender() {        return gender;    }    public void setGender(String gender) {        this.gender = gender;    }    @Override    public String toString() {        return "Person{" +                "id=" + id +                ", name='" + name + '\'' +                ", age=" + age +                ", gender='" + gender + '\'' +                '}';    }}
  </code>\`<code></p><p><li><strong>测试</strong></li></p><p>  MyTest.java</p><p></code>\`<code>java
import com.oi.bean.Person;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;public class MyTest {    public static void main(String[] args) {        ApplicationContext context = new ClassPathXmlApplicationContext("ioc.xml");        Person person = (Person) context.getBean("person");        System.out.println(person);    }}
</code>\`<code></p><p><strong>总结：</strong></p><p>​ 以上两种方式创建spring的项目都是可以的-但是在现在的企业开发环境中使用更多的还是maven这样的方式-无须自己处理jar之间的依赖关系-也无须提前下载jar包-只需要配置相关的pom即可-因此推荐大家使用maven的方式-具体的maven操作大家可以看maven的详细操作文档。</p><p>​ <strong>搭建spring项目需要注意的点：</strong></p><p>​ 1、一定要将配置文件添加到类路径中-使用idea创建项目的时候要放在resource目录下</p><p>​ 2、导包的时候别忘了commons-logging-1.2.jar包</p><p>​ <strong>细节点：</strong></p><p>​ 1、ApplicationContext就是IOC容器的接口-可以通过此对象获取容器中创建的对象</p><p>​ 2、对象在Spring容器创建完成的时候就已经创建完成-不是需要用的时候才创建</p><p>​ 3、对象在IOC容器中存储的时候都是单例的-如果需要多例需要修改属性</p><p>​ 4、创建对象给属性赋值的时候是通过setter方法实现的</p><p>​ 5、对象的属性是由setter/getter方法决定的-而不是定义的成员属性</p><p><h3>2、spring对象的获取及属性赋值方式</h3></p><p>##### <strong>1、通过bean的id获取IOC容器中的对象（上面已经用过）</strong></p><p>##### <strong>2、通过bean的类型获取对象</strong></p><p>​ MyTest.java</p><p></code>\`<code>java
import com.oi.bean.Person;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;public class MyTest {    public static void main(String[] args) {        ApplicationContext context = new ClassPathXmlApplicationContext("ioc.xml");        Person bean = context.getBean(Person.class);        System.out.println(bean);    }}
</code>\`<code></p><p>注意：通过bean的类型在查找对象的时候-在配置`,
    author: defaultAuthor,
    readTime: '43 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-23-spring"],
  },
  {
    title: "Java Concurrent Programming",
    excerpt: "Comprehensive guide to Java concurrency covering threads, synchronized, locks, concurrent collections, thread pools, and JUC utilities.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-05-23-java',
    date: 'May 23, 2020',
    category: 'Backend',
    tags: ["Java SE","Multithreading","JUC"],
    slug: '2020-05-23-java',
    content: `<p><h3>线程</h3></p><p>#### 概念</p><p><img src="/images/blog/image-20200331171617504.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/01_02.jpg" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200522121553190.png" alt="illustration" class="my-4" /></p><p>什么是叫一个进程？ 什么叫一个线程？</p><p><img src="/images/blog/image-20200522121725120.png" alt="illustration" class="my-4" /></p><p><li>Program app ->QQ.exe</li></p><p>  <strong>进程：</strong>做一个简单的解释-你的硬盘上有一个简单的程序-这个程序叫QQ.exe-这是一个程序-这个程序是一个静态的概念-它被扔在硬盘上也没人理他-但是当你双击它-弹出一个界面输入账号密码登录进去了-OK-这个时候叫做一个进程。进程相对于程序来说它是一个动态的概念</p><p>  <strong>线程：</strong>作为一个进程里面最小的执行单元它就叫一个线程-用简单的话讲一个程序里不同的执行路径就叫做一个线程</p><p>#### 启动线程的五种方式</p><p>1: 继承Thread类 2: 实现Runnable 3: 线程池Executors.newCachedThrad</p><p>\`\`<code>java
package com.oi.juc.c_000;import java.util.concurrent.Callable;import java.util.concurrent.ExecutorService;import java.util.concurrent.Executors;import java.util.concurrent.FutureTask;public class T02_HowToCreateThread {    static class MyThread extends Thread {        @Override        public void run() {            System.out.println("Hello MyThread!");        }    }    static class MyRun implements Runnable {        @Override        public void run() {            System.out.println("Hello MyRun!");        }    }    static class MyCall implements Callable {        @Override        public String call() {            System.out.println("Hello MyCall");            return "success";        }    }    //启动线程的5种方式    public static void main(String[] args) {        // 继承Thread        new MyThread().start();        // 实现Runable        new Thread(new MyRun()).start();        // Lambda        new Thread(()->{            System.out.println("Hello Lambda!");        }).start();		// 实现Callable        Thread t = new Thread(new FutureTask(new MyCall()));        t.start();		// 缓存线程池        ExecutorService service = Executors.newCachedThreadPool();        service.execute(()->{            System.out.println("Hello ThreadPool");        });        service.shutdown();    }}
</code>\`<code></p><p><img src="/images/blog/image-20200526060941085.png" alt="illustration" class="my-4" /><img src="/images/blog/image-20200526061909808.png" alt="illustration" class="my-4" /></p><p>#### 生命周期</p><p>wait(), join(), LockSupport() 进入waiting状态; notify(), notifyAll(), LockSupport  
yield() Running –> Ready  
等待过得同步代码块的锁, 进入Blocked状态, 获得后, 进入Runnale  
<img src="/images/blog/image-20200522122259623.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200331201536720.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200526061523926.png" alt="illustration" class="my-4" /></p><p>#### 常用方法</p><p></code>\`<code>java
package com.oi.juc.c_000;public class T03_Sleep_Yield_Join {    public static void main(String[] args) {					//testSleep();					//testYield();        testJoin();    } 		/*Sleep,意思就是睡眠-当前线程暂停一段时间让给别的线程去运行。Sleep是怎么复活的？由你的睡眠时间而定-等睡眠到规定的时间自动复活*/    static void testSleep() {        new Thread(()->{            for(int i=0; i<100; i++) {                System.out.println("A" + i);                try {                    Thread.sleep(500);                    //TimeUnit.Milliseconds.sleep(500)                } catch (InterruptedException e) {                    e.printStackTrace();                }            }        }).start();    }		/*Yield,就是当前线程正在执行的时候停止下来进入等待队列-回到等待队列里在系统的调度算法里头呢还是依然有可能把你刚回去的这个线程拿回来继续执行-当然-更大的可能性是把原来等待的那些拿出一个来执行-所以yield的意思是我让出一下CPU-后面你们能不能抢到那我不管*/    static void testYield() {        new Thread(()->{            for(int i=0; i<100; i++) {                System.out.println("A" + i);                if(i%10 == 0) Thread.yield();            }        }).start();        new Thread(()->{            for(int i=0; i<100; i++) {                System.out.println("------------B" + i);                if(i%10 == 0) Thread.yield();            }        }).start();    }		/*join- 意思就是在自己当前线程加入你调用Join的线程（）-本线程等待。等调用的线程运行完了-自己再去执行。t1和t2两个线程-在t1的某个点上调用了t2.join,它会跑到t2去运行-t1等待t2运行完毕继续t1运行（自己join自己没有意义） */    static void testJoin() {        Thread t1 = new Thread(()->{            for(int i=0; i<100; i++) {                System.out.println("A" + i);                try {                    Thread.sleep(500);                    //TimeUnit.Milliseconds.sleep(500)                } catch (InterruptedException e) {                    e.printStackTrace();                }            }        });        Thread t2 = new Thread(()->{            try {                t1.join();            } catch (InterruptedException e) {                e.printStackTrace();            }            for(int i=0; i<100; i++) {                System.out.println("A" + i);                try {                    Thread.sleep(500);                    //TimeUnit.Milliseconds.sleep(500)                } catch (InterruptedException e) {                    e.printStackTrace();                }            }        });        t1.start();        t2.start();    }}
</code>\`<code></p><`,
    author: defaultAuthor,
    readTime: '170 min read',
    relatedPosts: ["2020-06-13","2020-06-21-maven"],
  },
  {
    title: "Introduction to Spring Framework",
    excerpt: "Getting started with Spring Framework fundamentals including IoC container, dependency injection principles, and core module architecture.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-05-23-spring',
    date: 'May 23, 2020',
    category: 'Spring',
    tags: ["Spring"],
    slug: '2020-05-23-spring',
    content: `<p><h1>Spring初识</h1></p><p><h3>1、框架</h3></p><p>​ 框架就是一些类和接口的集合-通过这些类和接口协调来完成一系列的程序实现。JAVA框架可以分为三层：表示层-业务层和物理层。框架又叫做开发中的半成品-它不能提供整个WEB应用程序的所有东西-但是有了框架-我们就可以集中精力进行业务逻辑的开发而不用去关心它的技术实现以及一些辅助的业务逻辑。大家熟知的Structs和Spring就是表示层和业务层框架的强力代表。（官方）</p><p>​ 白话：</p><p>​ 框架就是某些个人或者组织定义了一系列的类或者接口-提前定义好了一些实现-用户可以在这些类和接口的基础之上-使用这些类来迅速的形成某个领域或者某个行业的解决方案-简化开发的过程-提高开发的效率。就好比：你要盖一座房子-先把柱子-房梁等先建设好-然后只需要向房子中填充就可以了-可以按照自己的需求进行设计-其实我们做的项目、系统都是类似的方式-如果所有的代码全部都需要自己实现-那么这个工程就太庞大了-所以可以先创建出一些基础的模板框架-开发人员只需要按照自己的需求向架子中填充内容-完成自己独特需求即可-这就是框架存在的意义。其实我们之前定义的简单的工具类这些东西也是类似的原理-只不过比较单一简单而已-因此-在现在的很多项目系统开发的过程中都是利用框架进行开发。</p><p><h3>2、spring（春天）</h3></p><p><strong>架构设计</strong></p><p>​ 随着互联网的发展-网站应用的规模不断扩大-常规的垂直应用架构已无法应对-分布式服务架构以及流动计算架构势在必行-亟需一个治理系统确保架构有条不紊的演进。</p><p><img src="/images/blog/dubbo-architecture-roadmap-1596445585761.jpg" alt="illustration" class="my-4" /></p><p>​ 单一应用架构</p><p>​ 当网站流量很小时-只需一个应用-将所有功能都部署在一起-以减少部署节点和成本。此时-用于简化增删改查工作量的数据访问框架(ORM)是关键。</p><p>​ 垂直应用架构</p><p>​ 当访问量逐渐增大-单一应用增加机器带来的加速度越来越小-提升效率的方法之一是将应用拆成互不相干的几个应用-以提升效率。此时-用于加速前端页面开发的Web框架(MVC)是关键。</p><p>​ 分布式服务架构</p><p>​ 当垂直应用越来越多-应用之间交互不可避免-将核心业务抽取出来-作为独立的服务-逐渐形成稳定的服务中心-使前端应用能更快速的响应多变的市场需求。此时-用于提高业务复用及整合的分布式服务框架(RPC)是关键。</p><p>​ 流动计算架构</p><p>​ 当服务越来越多-容量的评估-小服务资源的浪费等问题逐渐显现-此时需增加一个调度中心基于访问压力实时管理集群容量-提高集群利用率。此时-用于提高机器利用率的资源调度和治理中心(SOA)是关键。</p><p><strong>Java主流框架演变之路</strong></p><p>​ 1、JSP+Servlet+JavaBean</p><p>​ 2、MVC三层架构</p><p><img src="/images/blog/mvc-1596445585762.png" alt="illustration" class="my-4" /></p><p>​ 3、使用EJB进行应用的开发-但是EJB是重量级框架（在使用的时候-过多的接口和依赖-侵入性强）-在使用上比较麻烦</p><p>​ 4、Struts1/Struts2+Hibernate+Spring</p><p>​ 5、SpringMVC+Mybatis+Spring</p><p>​ 6、SpringBoot开发-约定大于配置</p><p><strong>Spring官网</strong></p><p>官网地址：<a href="https://spring.io/projects/spring-framework#overview">https://spring.io/projects/spring-framework#overview</a></p><p>压缩包下载地址：<a href="https://repo.spring.io/release/org/springframework/spring/">https://repo.spring.io/release/org/springframework/spring/</a></p><p>源码地址：<a href="https://github.com/spring-projects/spring-framework">https://github.com/spring-projects/spring-framework</a></p><p>\`\`<code>tex
Spring makes it easy to create Java enterprise applications. It provides everything you need to embrace the Java language in an enterprise environment, with support for Groovy and Kotlin as alternative languages on the JVM, and with the flexibility to create many kinds of architectures depending on an application’s needs. As of Spring Framework 5.1, Spring requires JDK 8+ (Java SE 8+) and provides out-of-the-box support for JDK 11 LTS. Java SE 8 update 60 is suggested as the minimum patch release for Java 8, but it is generally recommended to use a recent patch release.Spring supports a wide range of application scenarios. In a large enterprise, applications often exist for a long time and have to run on a JDK and application server whose upgrade cycle is beyond developer control. Others may run as a single jar with the server embedded, possibly in a cloud environment. Yet others may be standalone applications (such as batch or integration workloads) that do not need a server.Spring is open source. It has a large and active community that provides continuous feedback based on a diverse range of real-world use cases. This has helped Spring to successfully evolve over a very long time.Spring 使创建 Java 企业应用程序变得更加容易。它提供了在企业环境中接受 Java 语言所需的一切,-并支持 Groovy 和 Kotlin 作为 JVM 上的替代语言-并可根据应用程序的需要灵活地创建多种体系结构。 从 Spring Framework 5.0 开始-Spring 需要 JDK 8(Java SE 8+)-并且已经为 JDK 9 提供了现成的支持。Spring支持各种应用场景- 在大型企业中, 应用程序通常需要运行很长时间-而且必须运行在 jdk 和应用服务器上-这种场景开发人员无法控制其升级周期。 其他可能作为一个单独的jar嵌入到服务器去运行-也有可能在云环境中。还有一些可能是不需要服务器的独立应用程序(如批处理或集成的工作任务)。Spring 是开源的。它拥有一个庞大而且活跃的社区-提供不同范围的-真实用户的持续反馈。这也帮助Spring不断地改进,不断发展。
</code>\`<code></p><p><strong>核心解释</strong></p><p>​ spring是一个开源框架。</p><p>​ spring是为了简化企业开发而生的-使得开发变得更加优雅和简洁。</p><p>​ spring是一个<strong>IOC</strong>和<strong>AOP</strong>的容器框架。</p><p>​ IOC：控制反转</p><p>​ AOP：面向切面编程</p><p>​ 容器：包含并管理应用对象的生命周期-就好比用桶装水一样-spring就是桶-而对象就是水</p><p><strong>使用spring的优点</strong></p><p>​ 1、Spring通过DI、AOP和消除样板式代码来简化企业级Java开发</p><p>​ 2、Spring框架之外还存在一个构建在核心框架之上的庞大生态圈-它将Spring扩展到不同的领域-如Web服务、REST、移动开发以及NoSQL</p><p>​ 3、低侵入式设计-代码的污染极低</p><p>​ 4、独立于各种应用服务器-基于Spring框架的应用-可以真正实现Write Once,Run Anywhere的承诺</p><p>​ 5、Spring的IoC容器降低了业务对象替换的复杂性-提高了组件之间的解耦</p><p>​ 6、Spring的AOP支持允许将一些通用任务如安全、事务、日志等进行集中式处理-从而提供了更好的复用</p><p>​ 7、Spring的ORM和DAO提供了与第三方持久层框架的的良好整合-并简化了底层的数据库访问</p><p>​ 8、Spring的高度开放性-并不强制应用完全依赖于Spring-开发者可自由选用Spring框架的部分或全部</p><p><strong>如何简化开发</strong></p><p>​ 基于POJO的轻量级和最小侵入性编程</p><p>​ 通过依赖注入和面向接口实现松耦合</p><p>​ 基于切面和惯例进行声明式编程</p><p>​ 通过切面和模板减少样板式代码</p><p><strong>spring的模块划分图</strong></p><p><img src="/images/blog/spring-overview-1596445585762.png" alt="illustration" class="my-4" /></p><p></code>\`<code>plain
模块解释：Test:Spring的单元测试模块Core Container:核心容器模块AOP+Aspects:面向切面编程模块Instrumentation:提供了class instrumentation支持和类加载器的实现来在特定的应用服务器上使用,几乎不用Messaging:包括一系列的用来映射消息到方法的注解,几乎不用Data Access/Integration:数据的获取/整合模块-包括了JDBC,ORM,OXM,JMS和事务模块Web:提供面向web整合特性
</code>\`<code></p><p><h3>3、IOC（Inv`,
    author: defaultAuthor,
    readTime: '25 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "Nginx and Tengine Deep Dive",
    excerpt: "High-performance web server configuration guide covering Nginx and Tengine setup, reverse proxy, load balancing, and optimization techniques.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-06-12-nginxtengine',
    date: 'June 12, 2020',
    category: 'DevOps',
    tags: ["Nginx"],
    slug: '2020-06-12-nginxtengine',
    content: `<p><h1>Tengine</h1></p><p><h2>Nginx和Tengine</h2></p><p><h3>Nginx</h3></p><p>Nginx (“engine x”) 是一个高性能的 <strong>HTTP</strong> 和 <strong>反向代理</strong> 服务器-也是一个 IMAP/POP3/SMTP 代理服务器。</p><p>•第一个公开版本0.1.0发布于2004年10月4日。</p><p>其将源代码以类BSD许可证的形式发布-因它的稳定性、丰富的功能集、示例配置文件和低系统资源的消耗而闻名</p><p>官方测试nginx能够支撑5万并发链接-并且cpu、内存等资源消耗却非常低-运行非常稳定</p><p>2011年6月1日-nginx 1.0.4发布。</p><p>Nginx是一款轻量级的Web 服务器/反向代理服务器及电子邮件（IMAP/POP3）代理服务器-并在一个BSD-like 协议下发行。由俄罗斯的程序设计师Igor Sysoev所开发-</p><p>其特点是占有内存少-并发能力强-事实上nginx的并发能力确实在同类型的网页服务器中表现较好-中国大陆使用nginx网站用户有：新浪、网易、腾讯等。</p><p><img src="/images/blog/20200103154530929.png" alt="illustration" class="my-4" /></p><p>功能：</p><p><li>web服务器</li>
<li>web reverse proxy</li>
<li>smtp reverse proxy</li></p><p><h3>Nginx和apache的优缺点</h3></p><p>#### nginx相对于apache的优点：</p><p><li>轻量级-同样起web 服务-比apache 占用更少的内存及资源</li>
<li>抗并发-nginx 处理请求是异步非阻塞的-而apache 则是阻塞型的-在高并发下nginx 能保持低资源低消耗高性能</li>
<li>高度模块化的设计-编写模块相对简单</li>
<li>社区活跃-各种高性能模块出品迅速</li></p><p>#### apache 相对于nginx 的优点：</p><p><li>rewrite -比nginx 的rewrite 强大</li>
<li>模块超多-基本想到的都可以找到</li>
<li>少bug -nginx 的bug 相对较多</li></p><p>Nginx 配置简洁, Apache 复杂</p><p>最核心的区别在于apache是同步多进程模型-一个连接对应一个进程；</p><p>nginx是异步的-多个连接（万级别）可以对应一个进程</p><p><h2>Nginx解决的问题</h2></p><p><li>高并发</li>
<li>负载均衡</li>
<li>高可用</li>
<li>虚拟主机</li>
<li>伪静态</li>
<li>动静分离</li></p><p><h2>安装</h2></p><p><h3>准备工作</h3></p><p>#### 操作系统</p><p>最好使用linux操作系统-课上使用VirtualBox或VMware虚拟机搭建centos6.x做实验。</p><p>系统依赖组件 <code>gcc openssl-devel pcre-devel zlib-devel</code></p><p>安装：<code>yum install gcc openssl-devel pcre-devel zlib-devel</code></p><p>#### Tengine下载和文档</p><p><a href="http://tengine.taobao.org/">http://tengine.taobao.org/</a></p><p>#### Nginx官网和文档</p><p><a href="http://nginx.org">http://nginx.org</a></p><p>上传Nginx压缩包到服务器-一般安装在/usr/local目录下</p><p><h3>编译安装</h3></p><p>\`\`<code>shell
./ configure --prefix=/安装路径make && make install
</code>\`<code></p><p><h2>启动服务</h2></p><p><h3>脚本自启动</h3></p><p>拷贝附件提供的Nginx启动脚本文件内容到</code>/etc/init.d/nginx<code>这个文件中</p><p>目录下如果没有这个文件的话需要手动创建</p><p>#### 修改可执行权限</p><p>chmod 777 nginx</p><p>#### 启动服务</p><p>service Nginx start 启动服务</p><p>service Nginx stop 停止</p><p>service Nginx status 状态</p><p>service Nginx reload 动态重载配置文件</p><p>#### 脚本内容：</p><p></code>\`<code>shell
#!/bin/sh## nginx - this script starts and stops the nginx daemon## chkconfig:   - 85 15 # description:  Nginx is an HTTP(S) server, HTTP(S) reverse \#               proxy and IMAP/POP3 proxy server# processname: nginx# config:      /etc/nginx/nginx.conf# config:      /etc/sysconfig/nginx# pidfile:     /var/run/nginx.pid # Source function library.. /etc/rc.d/init.d/functions # Source networking configuration.. /etc/sysconfig/network # Check that networking is up.[ "\$NETWORKING" = "no" ] && exit 0 nginx="/usr/local/tengine/sbin/nginx"prog=\$(basename \$nginx) NGINX_CONF_FILE="/usr/local/tengine/conf/nginx.conf" [ -f /etc/sysconfig/nginx ] && . /etc/sysconfig/nginx lockfile=/var/lock/subsys/nginx make_dirs() {   # make required directories   user=</code>nginx -V 2>&1 | grep "configure arguments:" | sed 's/[^*]*--user=\([^ ]*\).*/\\1/g' -<code>   options=</code>\$nginx -V 2>&1 | grep 'configure arguments:'<code>   for opt in \$options; do       if [ </code>echo \$opt | grep '.*-temp-path'<code> ]; then           value=</code>echo \$opt | cut -d "=" -f 2<code>           if [ ! -d "\$value" ]; then               # echo "creating" \$value               mkdir -p \$value && chown -R \$user \$value           fi       fi   done} start() {    [ -x \$nginx ] || exit 5    [ -f \$NGINX_CONF_FILE ] || exit 6    make_dirs    echo -n \$"Starting \$prog: "    daemon \$nginx -c \$NGINX_CONF_FILE    retval=\$?    echo    [ \$retval -eq 0 ] && touch \$lockfile    return \$retval} stop() {    echo -n \$"Stopping \$prog: "    killproc \$prog -QUIT    retval=\$?    echo    [ \$retval -eq 0 ] && rm -f \$lockfile    return \$retval} restart() {    configtest || return \$?    stop    sleep 1    start} reload() {    configtest || return \$?    echo -n \$"Reloading \$prog: "    killproc \$nginx -HUP    RETVAL=\$?    echo} force_reload() {    restart} configtest() {  \$nginx -t -c \$NGINX_CONF_FILE} rh_status() {    status \$prog} rh_status_q() {    rh_status >/dev/null 2>&1} case "\$1" in    start)        rh_status_q && exit 0        \$1        ;;    stop)        rh_status_q || exit 0        \$1        ;;    restart|configtest)        \$1        ;;    reload)        rh_status_q || exit 7        \$1        ;;    force-reload)        force_reload        ;;    status)        rh_status        ;;    condrestart|try-restart)        rh_status_q || exit 0            ;;    *)        echo \$"Usage: \$0 {start|stop|status|restart|condrestart|try-restart|reload|force-reload|configtest}"        exit 2esac
</code>\`<code></p><p><h2>Nginx配置解析</h2></p><p><h3>定义Nginx运行的用户和用户组</h3></p><p></code>user www www;<code></p><p><h3>进程数</h3></p><p>建议设置为等于CPU总核心数。</p><p></code>worker_processes 8;<code></p><p><h3>全局错误日志</h3></p><p>全局错误日志定义类型-\[ debug | info | notice | warn | error | crit \]</p><p></code>error_log /var/log/nginx/error.log`,
    author: defaultAuthor,
    readTime: '33 min read',
    relatedPosts: [],
  },
  {
    title: "MySQL Index Optimization Case Study",
    excerpt: "Real-world MySQL index optimization cases with execution plan analysis, covering index selection, composite indexes, and query tuning.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-06-13-mysql',
    date: 'June 13, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-06-13-mysql',
    content: `<p><h1>MySQL之覆盖索引、最左前缀、索引下推案例</h1></p><p>#### 覆盖索引</p><p>mysql的innodb引擎通过搜索树方式实现索引-索引类型分为主键索引和二级索引（非主键索引）-主键索引树中-叶子结点保存着主键即对应行的全部数据；而二级索引树中-叶子结点保存着索引值和主键值-当使用二级索引进行查询时-需要进行回表操作。假如我们现在有如下表结构</p><p>\`\`<code>plain
CREATE TABLE </code>user_table<code> (  </code>id<code> int(11) unsigned NOT NULL AUTO_INCREMENT,  </code>username<code> varchar(255) NOT NULL,  </code>password<code> varchar(255) DEFAULT NULL,  </code>age<code> int(11) unsigned Not NULL,  PRIMARY KEY (</code>id<code>),  key (</code>username<code>)) ENGINE=InnoDB  DEFAULT CHARSET=utf8
</code>\`<code></p><p>执行语句(A) select id from user_table where username = ‘lzs’时-因为username索引树的叶子结点上保存有username和id的值-所以通过username索引树查找到id后-我们就已经得到所需的数据了-这时候就不需要再去主键索引上继续查找了。  
执行语句(B) select password from user_table where username = ‘lzs’时-流程如下</p><p>> 1、username索引树上找到username=lzs对应的主键id  
> 2、通过回表在主键索引树上找到满足条件的数据</p><p>由上面可知-当sql语句的所求查询字段（select列）和查询条件字段（where子句）全都包含在一个索引中-可以直接使用索引查询而不需要回表。这就是覆盖索引-通过使用覆盖索引-可以减少搜索树的次数-是常用的性能优化手段。  
例如上面的语句B是一个高频查询的语句-我们可以建立(username,password)的联合索引-这样-查询的时候就不需要再去回表操作了-可以提高查询效率。当然-添加索引是有维护代价的-所以添加时也要权衡一下。</p><p>#### 联合索引</p><p>mysql的b+树索引遵循“最左前缀”原则-继续以上面的例子来说明-为了提高语句B的执行速度-我们添加了一个联合索引（username,password）,特别注意这个联合索引的顺序-如果我们颠倒下顺序改成（password,username),这样查询能使用这个索引吗？答案是不能的！这是最左前缀的第一层含义：<strong>联合索引的多个字段中-只有当查询条件为联合索引的一个字段时-查询才能使用该索引。</strong>  
现在-假设我们有一下三种查询情景：  
1、查出用户名的第一个字是“张”开头的人的密码。即查询条件子句为”where username like ‘张%’”  
2、查处用户名中含有“张”字的人的密码。即查询条件子句为”where username like ‘%张%’”  
3、查出用户名以“张”字结尾的人的密码。即查询条件子句为”where username like ‘%张’”</p><p>以上三种情况下-只有第1种能够使用（username,password）联合索引来加快查询速度。这就是最左前缀的第二层含义：<strong>索引可以用于查询条件字段为索引字段-根据字段值最左若干个字符进行的模糊查询。</strong></p><p>维护索引需要代价-所以有时候我们可以利用“最左前缀”原则减少索引数量-上面的（username,password）索引-也可用于根据username查询age的情况。当然-使用这个索引去查询age的时候是需要进行回表的-当这个需求（根据username查询age）也是高频请求时-我们可以创建（username,password,age）联合索引-这样-我们需要维护的索引数量不变。</p><p>创建索引时-我们也要考虑空间代价-使用较少的空间来创建索引  
假设我们现在不需要通过username查询password了-相反-经常需要通过username查询age或通过age查询username,这时候-删掉（username,password）索引后-我们需要创建新的索引-我们有两种选择  
1、（username,age）联合索引+age字段索引  
2、（age,username）联合索引+username单字段索引  
一般来说-username字段比age字段大的多-所以-我们应选择第一种-索引占用空间较小。</p><p>#### 索引下推</p><p>对于user_table表-我们现在有（username,age）联合索引  
如果现在有一个需求-查出名称中以“张”开头且年龄小于等于10的用户信息-语句C如下：”select \* from user_table where username like ‘张%’ and age > 10”.  
语句C有两种执行可能：  
1、根据（username,age）联合索引查询所有满足名称以“张”开头的索引-然后回表查询出相应的全行数据-然后再筛选出满足年龄小于等于10的用户数据。过程如下图。</p><p><img src="/images/blog/5148507-1684dba15ec6fb78.png" alt="illustration" class="my-4" /></p><p>2、根据（username,age）联合索引查询所有满足名称以“张”开头的索引-然后直接再筛选出年龄小于等于10的索引-之后再回表查询全行数据。过程如下图。</p><p><img src="/images/blog/5148507-6179190f8409cf3b.png" alt="illustration" class="my-4" /></p><p>明显的-第二种方式需要回表查询的全行数据比较少-这就是mysql的索引下推。mysql默认启用索引下推-我们也可以通过修改系统变量optimizer_switch的index_condition_pushdown标志来控制</p><p></code>\`<code>plain
SET optimizer_switch = 'index_condition_pushdown=off';
</code>\`\`</p><p><li>注意点：  </li>
  1、innodb引擎的表-索引下推只能用于二级索引。</p><p>  > 就像之前提到的-innodb的主键索引树叶子结点上保存的是全行数据-所以这个时候索引下推并不会起到减少查询全行数据的效果。</p><p>  2、索引下推一般可用于所求查询字段（select列）不是/不全是联合索引的字段-查询条件为多条件查询且查询条件子句（where/order by）字段全是联合索引。</p><p>  > 假设表t有联合索引（a,b）,下面语句可以使用索引下推提高效率  
  > select \* from t where a > 2 and b > 10;</p>`,
    author: defaultAuthor,
    readTime: '8 min read',
    relatedPosts: ["2020-05-03-mysql","2020-07-03-mysql"],
  },
  {
    title: "QuickSort Optimization: Dutch Flag & Randomized Pivot",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-06-13',
    date: 'June 13, 2020',
    category: 'Backend',
    tags: ["Algorithm","Sorting"],
    slug: '2020-06-13',
    content: `<p><h3>快速排序</h3></p><p><img src="/images/blog/image-20200423062433436.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423062734100.png" alt="illustration" class="my-4" /> 小于等于num, 当前数和<=区下一个数交换 大于num, 直接跳下一个</p><p>分三段: 荷兰国旗问题  
<img src="/images/blog/image-20200423070643055.png" alt="illustration" class="my-4" />  
<img src="/images/blog/image-20200423063218126.png" alt="illustration" class="my-4" />  
\[ i \] == num, i++  
\[ i \] < num, \[ i \] 与<区右一个交换, <区右扩1位, i++  
\[ i \] > num, \[ i \] 与>区左一个交换, >区左扩1位, i不懂, 这个数还没比较过</p><p>荷兰国旗1: 以arr\[R\] 作为划分值  
<img src="/images/blog/image-20200423064734526.png" alt="illustration" class="my-4" />  
<img src="/images/blog/image-20200423064753839.png" alt="illustration" class="my-4" />  
<img src="/images/blog/image-20200423065349613.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200423070703395.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423065546159.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423065659272.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423065804180.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423125703988.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423065826323.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423065942356.png" alt="illustration" class="my-4" /> !\<a href="快速排序优化——荷兰国旗与随机快排/image-20200423070051147.png">image-20200423070051147\</a></p><p>1.0/2.0 时间复杂度</p><p><img src="/images/blog/image-20200423125738958.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423070015988.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423125821385.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200423070153215.png" alt="illustration" class="my-4" />!\<a href="快速排序优化——荷兰国旗与随机快排/image-20200423070221686.png">image-20200423070221686\</a></p><p>num在中间, 时间复杂度最低</p><p>概率累加 = O(N \* logN)</p><p>差情况随机发生  
<img src="/images/blog/image-20200423070613686.png" alt="illustration" class="my-4" /></p>`,
    author: defaultAuthor,
    readTime: '5 min read',
    relatedPosts: ["2020-05-23-java","2020-06-21-maven"],
  },
  {
    title: "Redis: Past, Present and Future",
    excerpt: "Evolution of data storage from files to databases to caching, with comprehensive Redis guide covering data types, persistence, and clustering.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-06-15-redis',
    date: 'June 15, 2020',
    category: 'Redis',
    tags: ["Redis","Cache"],
    slug: '2020-06-15-redis',
    content: `<p><h2>Redis的前世今生</h2></p><p><h3>基本介绍</h3></p><p>#### 数据存储演变过程</p><p><img src="/images/blog/image-20200408080531729.png" alt="illustration" class="my-4" /></p><p><li> <strong>数据存储在文件中：</strong>查找数据造成全量扫描-受限于磁盘IO的瓶颈</li>
<li> <strong>关系型数据库：</strong>关系型数据库是行级存储-会空出来没有数据列-受限于磁盘IO的瓶颈</li>
<li> <strong>数据库放入缓存：</strong>受限于硬件-成本高<img src="/images/blog/image-20200408115004299.png" alt="illustration" class="my-4" /></li></p><p><strong>数据的存储方式受限于：</strong></p><p><li> 冯诺依曼体系的硬件制约</li>
<li> 以太网, TCP/IP 的网络</li></p><p>Redis的特点-对比Memcache , value有类型 , 有类型对应的方法(API) , 计算向数据移动</p><p><img src="/images/blog/image-20200408130647248.png" alt="illustration" class="my-4" /></p><p>#### <strong>安装</strong></p><p><img src="/images/blog/image-20200408130854366.png" alt="illustration" class="my-4" /></p><p>\`\`<code>plain
centos 6.xredis官网5.xhttp://download.redis. io/releases/redis-5.0.5.tar.gz1 , yum install wget2,cd ~3,mkdir soft4,cd soft5,wget http://download.redis.io/releases/redis-5.0.5.tar.gz6,tar xf redis.. tar.gz7,cd redis-src8,看README md9, make.. install gcc..... make distclean10,make11,cdsrc .. .生成了可执行程序12, cd ..13,make install PREFIX=/opt/mashibing/redis514,vi /etc/profileexport REDIS_ _HOME= /opt/mashibing/redis5export PATH= \$PATH:\$REDIS_ _HOME/bin.source /etc/profile15,cd utils16,./install_ server.sh ( 可以执行- -次或多次))一个物理机中可以有多个redis实例(进程) ,通过port区分b)可执行程序就-份在目录,但是内存中未来的多个实例需要各自的配置文件,持久化目录等资源 c) service redis_ 6379 start/stop/stauts > linux /etc/init.d/***d)脚本还会帮你启动!17.ps -fe| grep redis
</code>\`<code></p><p><img src="/images/blog/image-20200408153530228.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200408184618523.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200408184643012.png" alt="illustration" class="my-4" /></p><p>#### <strong>BIO->同步非阻塞NIO->多路复用NIO</strong></p><p>内核不断变化</p><p><li> BIO阻塞: 读一个socket产生的文件描述符, 如果数据包没到, read命令就不能返回, 在这阻塞着, 抛出一个线程在这阻塞着, 有数据就处理, 下边的代码执行不了, 其他线程无法处理已到达的数据, socket是阻塞的  </li>
    一个线程的成本: 线程栈是独立的, 默认1MB, 线程多了, 调度成本提高. CPU浪费, 占用内存多
<li> 同步非阻塞NIO: 遍历, 取出来处理, 都由自己来完成, 同步非阻塞, 每个连接都要掉一次内核</li>
<li> 多路复用NIO: 内核select(), 允许一个程序监视多个文件描述符, 等待直到一个或多个文件描述符准备好, 就能触发I/O操作了 , 一次系统调用读若干个, 返回有数据的, 减少用户态内核态切换 , 选择有数据的, 直接读</li>
<li> 共享空间: 文件描述符都是累赘, 减少内核区域和用户空间之间传参, 把用户空间和内核空间建立映射, 相当于创建共享空间, 通过mmap系统调用, 红黑树+链表, 进程里有文件描述符就往红黑树里放, 内核可以看到, 把到达的放到链表里, 如果</li></p><p><img src="/images/blog/image-20200408155018832.png" alt="illustration" class="my-4" /></p><p>Redis进程的文件描述符  
0: 标准输入 1: 标准输出 2: 报错输出 3,4: pipe调用 5: epoll</p><p>kafka: sendfile + mmap  
零拷贝: sendfile系统调用</p><p><img src="/images/blog/image-20200408202046656.png" alt="illustration" class="my-4" /></p><p>Redis为什么快: epoll : epoll是 <a href="https://baike.baidu.com/item/Linux内核">Linux内核</a> 为处理大批量 <a href="https://baike.baidu.com/item/文件描述符/9809582">文件描述符</a> 而作了改进的poll-是Linux下多路复用IO接口select/poll的增强版本-它能显著提高程序在大量 <a href="https://baike.baidu.com/item/并发连接/3763280">并发连接</a> 中只有少量活跃的情况下的系统 <a href="https://baike.baidu.com/item/CPU/120556">CPU</a>利用率。另一点原因就是获取事件的时候-它无须遍历整个被侦听的描述符集-只要遍历那些被内核IO事件异步唤醒而加入Ready队列的描述符集合就行了。</p><p>顺序性: 每个连接内的命令顺序  
内存寻址是ns级, 网卡是ms级, 10万倍差距, 10万连接同时时到达, 可能会产生秒级响应  
mysql开启缓存, 想模仿redis, 性能反而会低, 多了一次判断过程, 增加了内存空间占用</p><p>#### <strong>类比Nginx</strong></p><p><img src="/images/blog/image-20200408204003689.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200408204441726.png" alt="illustration" class="my-4" /></p><p><h3>5种数据类型</h3></p><p><img src="/images/blog/image-20200409061635757.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200409075037824.png" alt="illustration" class="my-4" /></p><p>可以根据用户的指令, 看是不是和key里存的type匹配, 不匹配直接返回, 规避异常</p><p><img src="/images/blog/image-20200409001118398.png" alt="illustration" class="my-4" /></p><p>nx: 只能新建 分布式锁  
xx: 只能更新</p><p>#### String</p><p><img src="/images/blog/image-20200409113532196.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200409113353283.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200409003109666.png" alt="illustration" class="my-4" /></p><p>二进制安全: Redis只取字节流, 一个字符一个字节</p><p><img src="/images/blog/image-20200409003158840.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200409003251515.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200409003647771.png" alt="illustration" class="my-4" /></p><p>和Xshell设置有关</p><p><img src="/images/blog/image-20200409003835955.png" alt="illustration" class="my-4" /></p><p>GETSET减少一次I/O</p><p><img src="/images/blog/image-20200409004151835.png" alt="illustration" class="my-4" /></p><p>MSETNX原子性set, k2已经存在, 集体失败</p><p><img src="/images/blog/image-20200409004430586.png" alt="illustration" class="my-4" /></p><p>##### bitmap (活跃度|登录数)</p><p><img src="/images/blog/image-20200409055641576.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200409055518451.png" alt="illustration" class="my-4" /></p><p>按位与</p><p><img src="/images/blog/image-2020040`,
    author: defaultAuthor,
    readTime: '50 min read',
    relatedPosts: ["2020-07-23-redis"],
  },
  {
    title: "MyBatis SQL Mapping File Guide",
    excerpt: "Complete reference for MyBatis SQL mapping files including result maps, dynamic SQL, associations, and advanced mapping techniques.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-06-16-mybatis-sql',
    date: 'June 16, 2020',
    category: 'MyBatis',
    tags: ["Framework","MyBatis","ORM"],
    slug: '2020-06-16-mybatis-sql',
    content: `<p><h1>Mybatis SQL映射文件详解</h1></p><p>​ 在映射文件中-可以编写以下的顶级元素标签：</p><p>\`\`<code>plain
cache – 该命名空间的缓存配置。cache-ref – 引用其它命名空间的缓存配置。resultMap – 描述如何从数据库结果集中加载对象-是最复杂也是最强大的元素。parameterMap – 老式风格的参数映射。此元素已被废弃-并可能在将来被移除！请使用行内参数映射。文档中不会介绍此元素。sql – 可被其它语句引用的可重用语句块。insert – 映射插入语句。update – 映射更新语句。delete – 映射删除语句。select – 映射查询语句。
</code>\`<code></p><p>​ 在每个顶级元素标签中可以添加很多个属性-下面我们开始详细了解下具体的配置。</p><p><h3>1、insert、update、delete元素</h3></p><p>属性</p><p>描述</p><p></code>id<code></p><p>在命名空间中唯一的标识符-可以被用来引用这条语句。</p><p></code>parameterType<code></p><p>将会传入这条语句的参数的类全限定名或别名。这个属性是可选的-因为 MyBatis 可以通过类型处理器（TypeHandler）推断出具体传入语句的参数-默认值为未设置（unset）。</p><p></code>parameterMap<code></p><p>用于引用外部 parameterMap 的属性-目前已被废弃。请使用行内参数映射和 parameterType 属性。</p><p></code>flushCache<code></p><p>将其设置为 true 后-只要语句被调用-都会导致本地缓存和二级缓存被清空-默认值：（对 insert、update 和 delete 语句）true。</p><p></code>timeout<code></p><p>这个设置是在抛出异常之前-驱动程序等待数据库返回请求结果的秒数。默认值为未设置（unset）（依赖数据库驱动）。</p><p></code>statementType<code></p><p>可选 STATEMENT-PREPARED 或 CALLABLE。这会让 MyBatis 分别使用 Statement-PreparedStatement 或 CallableStatement-默认值：PREPARED。</p><p></code>useGeneratedKeys<code></p><p>（仅适用于 insert 和 update）这会令 MyBatis 使用 JDBC 的 getGeneratedKeys 方法来取出由数据库内部生成的主键（比如：像 MySQL 和 SQL Server 这样的关系型数据库管理系统的自动递增字段）-默认值：false。</p><p></code>keyProperty<code></p><p>（仅适用于 insert 和 update）指定能够唯一识别对象的属性-MyBatis 会使用 getGeneratedKeys 的返回值或 insert 语句的 selectKey 子元素设置它的值-默认值：未设置（</code>unset<code>）。如果生成列不止一个-可以用逗号分隔多个属性名称。</p><p></code>keyColumn<code></p><p>（仅适用于 insert 和 update）设置生成键值在表中的列名-在某些数据库（像 PostgreSQL）中-当主键列不是表中的第一列的时候-是必须设置的。如果生成列不止一个-可以用逗号分隔多个属性名称。</p><p></code>databaseId<code></p><p>如果配置了数据库厂商标识（databaseIdProvider）-MyBatis 会加载所有不带 databaseId 或匹配当前 databaseId 的语句；如果带和不带的语句都有-则不带的会被忽略。</p><p></code>\`<code>xml
          insert into user(user_name) values(#{userName})                           select max(id)+1 from user              insert into user(id,user_name) values(#{id},#{userName})
</code>\`<code></p><p><h3>2、select元素</h3></p><p>##### 1、select的参数传递</p><p></code>\`<code>xml
            select * from emp where empno=#{empno} and ename=#{ename}                select * from emp where empno=#{empno} and ename=#{ename}
</code>\`<code></p><p>##### 2、参数的取值方式</p><p>​ 在xml文件中编写sql语句的时候有两种取值的方式-分别是#{}和\${}-下面来看一下他们之间的区别：</p><p></code>\`<code>xml
          select * from #{t} where empno=\${empno} and ename=\${ename}
</code>\`<code></p><p>##### 3、处理集合返回结果</p><p>EmpDao.xml</p><p></code>\`<code>xml
            select  * from emp                select * from emp where empno = #{empno}                    select * from emp
</code>\`<code></p><p>UserDao.java</p><p></code>\`<code>java
package com.mashibing.dao;import com.mashibing.bean.Emp;import org.apache.ibatis.annotations.MapKey;import org.apache.ibatis.annotations.Param;import java.util.List;import java.util.Map;public interface EmpDao {    public Emp findEmpByEmpno(Integer empno);    public int updateEmp(Emp emp);    public int deleteEmp(Integer empno);    public int insertEmp(Emp emp);    Emp selectEmpByNoAndName(@Param("empno") Integer empno, @Param("ename") String ename,@Param("t") String tablename);    Emp selectEmpByNoAndName2(Map map);    List selectAllEmp();    Map selectEmpByEmpReturnMap(Integer empno);    @MapKey("empno")    Map getAllEmpReturnMap();}
</code>\`<code></p><p>##### 4、自定义结果集—resultMap</p><p>Dog.java</p><p></code>\`<code>java
package com.mashibing.bean;public class Dog {    private Integer id;    private String name;    private Integer age;    private String gender;    public Integer getId() {        return id;    }    public void setId(Integer id) {        this.id = id;    }    public String getName() {        return name;    }    public void setName(String name) {        this.name = name;    }    public Integer getAge() {        return age;    }    public void setAge(Integer age) {        this.age = age;    }    public String getGender() {        return gender;    }    public void setGender(String gender) {        this.gender = gender;    }    @Override    public String toString() {        return "Dog{" +                "id=" + id +                ", name='" + name + '\'' +                ", age=" + age +                ", gender='" + gender + '\'' +                '}';    }}
</code>\`<code></p><p>dog.sql</p><p></code>\`<code>sql
/*Navicat MySQL Data TransferSource Server         : node01Source Server Version : 50729Source Host           : 192.168.85.111:3306Source Database       : demoTarget Server Type    : MYSQLTarget Server Version : 50729File Encoding         : 65001Date: 2020-03-24 23:54:22*/SET FOREIGN_KEY_CHECKS=0;-- ------------------------------ Table structure for </code>dog<code>-- ----------------------------DROP TABLE IF EXISTS </code>dog<code>;CREATE TABLE </code>dog<code> (  </code>id<code> int(11) NOT NULL AUTO_INCREMENT,  </code>dname<code> varchar(255) DEFAULT NULL,  </code>dage<code> int(11) DEFAULT NULL,  </code>dgender<code> varchar(255) DEFAULT NULL,  PRIMARY KEY (</code>id<code>)) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=u`,
    author: defaultAuthor,
    readTime: '57 min read',
    relatedPosts: ["2020-06-16-mybatis","2020-06-17-mybatis-plus"],
  },
  {
    title: "Introduction to MyBatis",
    excerpt: "Quick start guide to MyBatis ORM framework covering configuration, mappers, CRUD operations, and integration with Spring.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-06-16-mybatis',
    date: 'June 16, 2020',
    category: 'MyBatis',
    tags: ["Framework","MyBatis","ORM"],
    slug: '2020-06-16-mybatis',
    content: `<p><h1>Mybatis的介绍和基本使用</h1></p><p><h3>0、数据库操作框架的历程</h3></p><p>##### (1) JDBC</p><p>​ JDBC(Java Data Base Connection,java数据库连接)是一种用于执行SQL语句的Java API,可以为多种关系数据库提供统一访问,它由一组用Java语言编写的类和接口组成.JDBC提供了一种基准,据此可以构建更高级的工具和接口,使数据库开发人员能够编写数据库应用程序</p><p><li>优点：运行期：快捷、高效</li>
<li>缺点：编辑期：代码量大、繁琐异常处理、不支持数据库跨平台</li></p><p><img src="/images/blog/jdbc.jpg" alt="illustration" class="my-4" /></p><p>##### (2) DBUtils</p><p>​ DBUtils是Java编程中的数据库操作实用工具-小巧简单实用。</p><p>​ DBUtils封装了对JDBC的操作-简化了JDBC操作-可以少写代码。</p><p>​ DBUtils三个核心功能介绍</p><p>​ 1、QueryRunner中提供对sql语句操作的API</p><p>​ 2、ResultSetHandler接口-用于定义select操作后-怎样封装结果集</p><p>​ 3、DBUtils类-它就是一个工具类-定义了关闭资源与事务处理的方法</p><p>##### (3)Hibernate</p><p>​ Hibernate 是由 Gavin King 于 2001 年创建的开放源代码的对象关系框架。它强大且高效的构建具有关系对象持久性和查询服务的 Java 应用程序。</p><p>​ Hibernate 将 Java 类映射到数据库表中-从 Java 数据类型中映射到 SQL 数据类型中-并把开发人员从 95% 的公共数据持续性编程工作中解放出来。</p><p>​ Hibernate 是传统 Java 对象和数据库服务器之间的桥梁-用来处理基于 O/R 映射机制和模式的那些对象。</p><p><img src="/images/blog/hibernate.jpg" alt="illustration" class="my-4" /></p><p>​ <strong>Hibernate 优势</strong></p><p><li>Hibernate 使用 XML 文件来处理映射 Java 类别到数据库表格中-并且不用编写任何代码。</li>
<li>为在数据库中直接储存和检索 Java 对象提供简单的 APIs。</li>
<li>如果在数据库中或任何其它表格中出现变化-那么仅需要改变 XML 文件属性。</li>
<li>抽象不熟悉的 SQL 类型-并为我们提供工作中所熟悉的 Java 对象。</li>
<li>Hibernate 不需要应用程序服务器来操作。</li>
<li>操控你数据库中对象复杂的关联。</li>
<li>最小化与访问数据库的智能提取策略。</li>
<li>提供简单的数据询问。</li></p><p>  <strong>Hibernate劣势</strong></p><p><li>hibernate的完全封装导致无法使用数据的一些功能。</li>
<li>Hibernate的缓存问题。</li>
<li>Hibernate对于代码的耦合度太高。</li>
<li>Hibernate寻找bug困难。</li>
<li>Hibernate批量数据操作需要大量的内存空间而且执行过程中需要的对象太多</li></p><p>  ##### (4) JDBCTemplate</p><p>​ JdbcTemplate针对数据查询提供了多个重载的模板方法,你可以根据需要选用不同的模板方法.如果你的查询很简单-仅仅是传入相应SQL或者相关参数-然后取得一个单一的结果-那么你可以选择如下一组便利的模板方法。</p><p>​ 优点：运行期：高效、内嵌Spring框架中、支持基于AOP的声明式事务  
​ 缺点：必须于Spring框架结合在一起使用、不支持数据库跨平台、默认没有缓存</p><p><h3>1、什么是Mybatis？</h3></p><p>​ MyBatis 是一款优秀的持久层框架-它支持自定义 SQL、存储过程以及高级映射。MyBatis 免除了几乎所有的 JDBC 代码以及设置参数和获取结果集的工作。MyBatis 可以通过简单的 XML 或注解来配置和映射原始类型、接口和 Java POJO（Plain Old Java Objects-普通老式 Java 对象）为数据库中的记录。</p><p>​ <strong>优点：</strong></p><p>​ 1、与JDBC相比-减少了50%的代码量</p><p>​ 2、 最简单的持久化框架-简单易学</p><p>​ 3、SQL代码从程序代码中彻底分离出来-可以重用</p><p>​ 4、提供XML标签-支持编写动态SQL</p><p>​ 5、提供映射标签-支持对象与数据库的ORM字段关系映射</p><p>​ <strong>缺点：</strong></p><p>​ 1、SQL语句编写工作量大-熟练度要高</p><p>​ 2、数据库移植性比较差-如果需要切换数据库的话-SQL语句会有很大的差异</p><p><h3>2、第一个Mybatis项目</h3></p><p>​ 1、创建普通的maven项目</p><p>​ 2、导入相关的依赖</p><p>​ pom.xml</p><p>\`\`<code>xml
    4.0.0    com.oi    mybatis_helloworld    1.0-SNAPSHOT                        org.mybatis            mybatis            3.5.4                                    mysql            mysql-connector-java            8.0.16                                    log4j            log4j            1.2.17
</code>\`<code></p><p>​ 3、创建对应的数据表-数据表我们使用之前的demo数据库-脚本文件在群里-大家自行去下载安装</p><p>​ 4、创建与表对应的实体类对象</p><p>emp.java</p><p></code>\`<code>java
package com.oi.bean;import java.util.Date;public class Emp {    private Integer empno;    private String ename;    private String job;    private Integer mgr;    private Date hiredate;    private Double sal;    private Double common;    private Integer deptno;    public Emp() {    }    public Emp(Integer empno, String ename, String job, Integer mgr, Date hiredate, Double sal, Double common, Integer deptno) {        this.empno = empno;        this.ename = ename;        this.job = job;        this.mgr = mgr;        this.hiredate = hiredate;        this.sal = sal;        this.common = common;        this.deptno = deptno;    }    public Integer getEmpno() {        return empno;    }    public void setEmpno(Integer empno) {        this.empno = empno;    }    public String getEname() {        return ename;    }    public void setEname(String ename) {        this.ename = ename;    }    public String getJob() {        return job;    }    public void setJob(String job) {        this.job = job;    }    public Integer getMgr() {        return mgr;    }    public void setMgr(Integer mgr) {        this.mgr = mgr;    }    public Date getHiredate() {        return hiredate;    }    public void setHiredate(Date hiredate) {        this.hiredate = hiredate;    }    public Double getSal() {        return sal;    }    public void setSal(Double sal) {        this.sal = sal;    }    public Double getCommon() {        return common;    }    public void setCommon(Double common) {        this.common = common;    }    public Integer getDeptno() {        return deptno;    }    public void setDeptno(Integer deptno) {        this.deptno = deptno;    }    @Override    public String toString() {        return "Emp{" +                "empno=" + empno +                ", ename='" + ename + '\'' +                ", job='" + job + '\'' +                ", mgr=" + mgr +                ", hiredate=" + hiredate +                ", sal=" + sal +                ", common=" + common +                ", deptno=" + deptno +                '}';    }}
</code>\`<code></p><p>​ 5、创建对应的dao类</p><p>EmpDao.java</p><p></code>\`<code>java
package com.oi.dao;import com.oi.bean.Emp;public interface EmpD`,
    author: defaultAuthor,
    readTime: '25 min read',
    relatedPosts: ["2020-06-16-mybatis-sql","2020-06-17-mybatis-plus"],
  },
  {
    title: "MyBatis-Plus Code Generator",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-06-17-mybatis-plus',
    date: 'June 17, 2020',
    category: 'MyBatis',
    tags: ["Framework","MyBatis","ORM"],
    slug: '2020-06-17-mybatis-plus',
    content: `<p><h1>Mybatis-plus的使用</h1></p><p>​ MyBatis-Plus（简称 MP）是一个 MyBatis的增强工具-在 MyBatis 的基础上只做增强不做改变-为简化开发、提高效率而生。</p><p>​ 特性：</p><p><li><strong>无侵入</strong>：只做增强不做改变-引入它不会对现有工程产生影响-如丝般顺滑</li>
<li><strong>损耗小</strong>：启动即会自动注入基本 CURD-性能基本无损耗-直接面向对象操作</li>
<li><strong>强大的 CRUD 操作</strong>：内置通用 Mapper、通用 Service-仅仅通过少量配置即可实现单表大部分 CRUD 操作-更有强大的条件构造器-满足各类使用需求</li>
<li><strong>支持 Lambda 形式调用</strong>：通过 Lambda 表达式-方便的编写各类查询条件-无需再担心字段写错</li>
<li><strong>支持主键自动生成</strong>：支持多达 4 种主键策略（内含分布式唯一 ID 生成器 - Sequence）-可自由配置-完美解决主键问题</li>
<li><strong>支持 ActiveRecord 模式</strong>：支持 ActiveRecord 形式调用-实体类只需继承 Model 类即可进行强大的 CRUD 操作</li>
<li><strong>支持自定义全局通用操作</strong>：支持全局通用方法注入（ Write once, use anywhere ）</li>
<li><strong>内置代码生成器</strong>：采用代码或者 Maven 插件可快速生成 Mapper 、 Model 、 Service 、 Controller 层代码-支持模板引擎-更有超多自定义配置等您来使用</li>
<li><strong>内置分页插件</strong>：基于 MyBatis 物理分页-开发者无需关心具体操作-配置好插件之后-写分页等同于普通 List 查询</li>
<li><strong>分页插件支持多种数据库</strong>：支持 MySQL、MariaDB、Oracle、DB2、H2、HSQL、SQLite、Postgre、SQLServer 等多种数据库</li>
<li><strong>内置性能分析插件</strong>：可输出 Sql 语句以及其执行时间-建议开发测试时启用该功能-能快速揪出慢查询</li>
<li><strong>内置全局拦截插件</strong>：提供全表 delete 、 update 操作智能分析阻断-也可自定义拦截规则-预防误操作</li></p><p><h3>1、mybatis-plus环境搭建</h3></p><p>Emp.java</p><p>\`\`<code>java
package com.mashibing.bean;import java.util.Date;public class Emp {    private Integer empno;    private String eName;    private String job;    private Integer mgr;    private Date hiredate;    private Double sal;    private Double comm;    private Integer deptno;    public Emp() {    }    public Integer getEmpno() {        return empno;    }    public void setEmpno(Integer empno) {        this.empno = empno;    }    public String geteName() {        return eName;    }    public void seteName(String eName) {        this.eName = eName;    }    public String getJob() {        return job;    }    public void setJob(String job) {        this.job = job;    }    public Integer getMgr() {        return mgr;    }    public void setMgr(Integer mgr) {        this.mgr = mgr;    }    public Date getHiredate() {        return hiredate;    }    public void setHiredate(Date hiredate) {        this.hiredate = hiredate;    }    public Double getSal() {        return sal;    }    public void setSal(Double sal) {        this.sal = sal;    }    public Double getComm() {        return comm;    }    public void setComm(Double comm) {        this.comm = comm;    }    public Integer getDeptno() {        return deptno;    }    public void setDeptno(Integer deptno) {        this.deptno = deptno;    }    @Override    public String toString() {        return "Emp{" +                "empno=" + empno +                ", ename='" + eName + '\'' +                ", job='" + job + '\'' +                ", mgr=" + mgr +                ", hiredate=" + hiredate +                ", sal=" + sal +                ", comm=" + comm +                ", deptno=" + deptno +                '}';    }}
</code>\`<code></p><p>数据库表sql语句</p><p></code>\`<code>sql
CREATE TABLE </code>tbl_emp<code> (  </code>EMPNO<code> int(4) NOT NULL AUTO_INCREMENT,  </code>E_NAME<code> varchar(10) DEFAULT NULL,  </code>JOB<code> varchar(9) DEFAULT NULL,  </code>MGR<code> int(4) DEFAULT NULL,  </code>HIREDATE<code> date DEFAULT NULL,  </code>SAL<code> double(7,2) DEFAULT NULL,  </code>COMM<code> double(7,2) DEFAULT NULL,  </code>DEPTNO<code> int(4) DEFAULT NULL,  PRIMARY KEY (</code>EMPNO<code>)) ENGINE=InnoDB DEFAULT CHARSET=utf8;
</code>\`<code></p><p>pom.xml</p><p></code>\`<code>xml
    4.0.0    com.mashibing    mybatis_plus    1.0-SNAPSHOT                                com.baomidou            mybatis-plus            3.3.1                                    junit            junit            4.13            test                                    log4j            log4j            1.2.17                                    com.alibaba            druid            1.1.21                                    mysql            mysql-connector-java            8.0.19                                    org.springframework            spring-context            5.2.3.RELEASE                                    org.springframework            spring-orm            5.2.3.RELEASE
</code>\`<code></p><p>mybatis-config.xml</p><p>log4j.properties</p><p></code>\`<code>properties
<h1>全局日志配置log4j.rootLogger=INFO, stdout# MyBatis 日志配置log4j.logger.com.mashibing=truce# 控制台输出log4j.appender.stdout=org.apache.log4j.ConsoleAppenderlog4j.appender.stdout.layout=org.apache.log4j.PatternLayoutlog4j.appender.stdout.layout.ConversionPattern=%5p [%t] - %m%n</h1>
</code>\`<code></p><p>db.properties</p><p></code>\`<code>properties
driverClassname=com.mysql.cj.jdbc.Driverusername=rootpassword=123456url=jdbc:mysql://192.168.85.111:3306/demo?serverTimezone=UTC
</code>\`<code></p><p>spring.xml</p><p>MyTest.java</p><p></code>\`<code>java
package com.mashibing;import com.alibaba.druid.pool.DruidDataSource;import org.junit.Test;import org.springframework.context.ApplicationContext;import org.springframework.context.suppor`,
    author: defaultAuthor,
    readTime: '51 min read',
    relatedPosts: ["2020-06-16-mybatis-sql","2020-06-16-mybatis"],
  },
  {
    title: "Maven Basics",
    excerpt: "Essential Maven guide for Java developers covering project structure, dependencies, plugins, lifecycle phases, and multi-module projects.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-06-21-maven',
    date: 'June 21, 2020',
    category: 'Backend',
    tags: ["Maven","Project Management"],
    slug: '2020-06-21-maven',
    content: `<p><h1>Maven的介绍与使用</h1></p><p><h3>1、Maven的简单介绍</h3></p><p>​ Maven是Apache下的项目管理工具-它由纯Java语言开发-可以帮助我们更方便的管理和构建Java项目。</p><p>​ Maven的优点</p><p>​ 1、 jar包管理：</p><p>​ a) 从Maven中央仓库获取标准的规范的jar包以及相关依赖的jar包-避免自己下载到错误的jar包；</p><p>​ b) 本地仓库统一管理jar包-使jar包与项目分离-减轻项目体积。</p><p>​ 2、 Maven是跨平台的可以在window、linux上使用。</p><p>​ 3、 清晰的项目结构；</p><p>​ 4、 多工程开发-将模块拆分成若干工程-利于团队协作开发。</p><p>​ 5、 一键构建项目：使用命令可以对项目进行一键构建。</p><p><h3>2、Maven的安装</h3></p><p>​ Maven官网：<a href="https://Maven.apache.org/">https://Maven.apache.org/</a></p><p>​ Maven仓库：<a href="https://mvnrepository.com/">https://mvnrepository.com/</a></p><p>​ 安装步骤：</p><p>\`\`<code>plain
1、安装jdk2、从官网中下载对应的版本3、解压安装-然后配置环境变量-需要配置Maven_HOME,并且将bin目录添加到path路径下4、在命令行中输入mvn -v,看到版本信息表示安装成功
</code>\`<code></p><p><h3>3、Maven的基本常识</h3></p><p><strong>Maven如何获取jar包</strong></p><p>​ Maven通过坐标的方式来获取 jar包-坐标组成为：公司/组织（groupId）+项目名（artifactId）+版本（version）组成-可以从互联网-本地等多种仓库源获取jar包</p><p><strong>Maven仓库的分类</strong></p><p>​ 本地仓库：本地仓库就是开发者本地已经下载下来的或者自己打包所有jar包的依赖仓库-本地仓库路径配置在Maven对应的conf/settings.xml配置文件。</p><p>​ 私有仓库：私有仓库可以理解为自己公司的仓库-也叫Nexus私服</p><p>​ 中央仓库：中央仓库即Maven默认下载的仓库地址-是Maven维护的</p><p><strong>Maven的常用仓库</strong></p><p>​ 由于网络访问的原因-在国内如果需要下载国外jar包的时候会受限-因此一般在使用过程中需要修改Maven的配置文件-将下载jar包的仓库地址修改为国内的源-常用的是阿里云的mvn仓库-修改配置如下：</p><p></code>\`<code>xml
aliMavenaliyun Mavenhttp://Maven.aliyun.com/nexus/content/groups/public/central
</code>\`\`</p><p><h3>4、Maven常用命令</h3></p><p><li>clean：清理编译后的目录</li>
<li>compile：编译-只编译main目录-不编译test中的代码</li>
<li>test-compile：编译test目录下的代码</li>
<li>test：运行test中的代码</li>
<li>package：打包-将项目打包成jar包或者war包</li>
<li>install：发布项目到本地仓库-用在打jar包上-打成的jar包可以被其他项目使用</li>
<li>deploy：打包后将其安装到pom文件中配置的远程仓库</li>
<li>site：生成站点目录</li></p>`,
    author: defaultAuthor,
    readTime: '4 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "GC Principles and JVM Tuning",
    excerpt: "Master garbage collection algorithms and JVM performance tuning including heap sizing, GC selection, and monitoring techniques.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-06-23-gcjvm',
    date: 'June 23, 2020',
    category: 'Java',
    tags: ["JVM","GC","Tuning"],
    slug: '2020-06-23-gcjvm',
    content: `<p><h1>GC 及 JVM Tuning</h1></p><p><h3>GC的基础知识</h3></p><p>#### 1.什么是垃圾</p><p><img src="/images/blog/image-20200514201439482.png" alt="illustration" class="my-4" /></p><p>> C语言申请内存：malloc free
>
> C++： new delete
>
> c/C++ 手动回收内存-比较精确-开发效率低
>
> Java: new ？
>
> 自动内存回收-编程上简单-系统不容易出错-手动释放内存-容易出两种类型的问题：
>
> 1.  忘记回收
> 2.  多次回收</p><p>没有任何引用指向的一个对象或者多个对象（循环引用）</p><p><img src="/images/blog/image-20200514201402853.png" alt="illustration" class="my-4" /></p><p>#### 2.如何定位垃圾</p><p><img src="/images/blog/image-20200514201631482.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200514201701612.png" alt="illustration" class="my-4" /></p><p><li> 引用计数（ReferenceCount）</li></p><p>    不能解决循环引用-可能都是1</p><p>    <img src="/images/blog/image-20200514201758859.png" alt="illustration" class="my-4" /></p><p><li> 根可达算法(RootSearching)</li></p><p>    <img src="/images/blog/image-20200514202139228.png" alt="illustration" class="my-4" /></p><p>#### 3.常见的垃圾回收算法</p><p><img src="/images/blog/image-20200514202209712.png" alt="illustration" class="my-4" /></p><p><li> 标记清除(mark sweep) - 没用的标记出来-直接清掉-其他不动  </li>
    不适合伊甸区  
    位置不连续-容易产生碎片-效率偏低（两遍扫描：1.找出有用的 2。找出没用的）  
    算法相对简单-存活对象比较多的情况下效率较高</p><p>    <img src="/images/blog/image-20200514202311041.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200514202408229.png" alt="illustration" class="my-4" /></p><p><li> 拷贝算法 (copying) - 有用的拷贝过来  </li>
    适合伊甸区  
    浪费空间  
    移动复制对象-需要调整对象引用  
    适用于存活对象较少的情况-只扫描一次-效率提高</p><p>    <img src="/images/blog/image-20200514202909198.png" alt="illustration" class="my-4" /> !\<a href="GC原理及JVM调优/image-20200514202929940.png">image-20200514202929940\</a></p><p><li> 标记压缩(mark compact) - 有用的聚到一起-没用的清掉-空间是连续的-慢  </li>
    没有碎片-方便对象分配  
    不会产生内存减半  
    需要移动对象-效率偏低（两遍扫描-指针需要调整）</p><p>    <img src="/images/blog/image-20200514205704893.png" alt="illustration" class="my-4" /> <img src="/images/blog/image-20200514205752680.png" alt="illustration" class="my-4" /></p><p>#### 4.JVM内存分代模型（用于分代垃圾回收算法）</p><p><li> 部分垃圾回收器使用的模型</li></p><p>    <img src="/images/blog/image-20200514210723893.png" alt="illustration" class="my-4" /> 新生代大量复制-少量存活-采用‘复制’算法 老年代存活率高-回收较少-采用‘标记清除’或‘标记压缩’</p><p>    > 除Epsilon ZGC Shenandoah之外的GC都是使用逻辑分代模型
    >
    > G1是逻辑分代-物理不分代
    >
    > 除此之外不仅逻辑分代-而且物理分代</p><p>逻辑分代：  
<img src="/images/blog/image-20200514215248207.png" alt="illustration" class="my-4" />新生代大量复制-少量存活-采用‘复制’算法  
老年代存活率高-回收较少-采用‘标记清除’或‘标记压缩’</p><p><li> 新生代 + 老年代 + 永久代（1.7）Perm Generation/ 元数据区(1.8) Metaspace</li>
    1.  永久代 元数据 - Class
    2.  永久代必须指定大小限制 -元数据可以设置-也可以不设置-无上限（受限于物理内存）
    3.  字符串常量 1.7 - 永久代-1.8 - 堆
    4.  MethodArea逻辑概念 - 永久代、元数据</p><p><li> 新生代 = Eden + 2个suvivor区  </li>
    默认8:1:1
    1.  YGC回收之后-大多数的对象会被回收-活着的进入s0
    2.  再次YGC-活着的对象eden + s0 -> s1
    3.  再次YGC-eden + s1 -> s0
    4.  年龄足够 -> 老年代 （15 CMS 6）
    5.  s区装不下 -> 老年代</p><p><li> 老年代</li>
    1.  顽固分子
    2.  老年代满了FGC Full GC</p><p><li> GC Tuning (Generation)</li></p><p>    <img src="/images/blog/image-20200514211954944.png" alt="illustration" class="my-4" />
    1.  尽量减少FGC
    2.  MinorGC = YGC：年轻代空间耗尽时触发
    3.  MajorGC = FullGC：在老年代无法继续分配空间时触发-新生代
    4.  \-Xms 最小内存
    5.  \-Xmx 最大内存</p><p><li> 对象分配过程图</li>
    1.  首先尝试栈上分配-分配不下-进入伊甸区
    2.  1次垃圾回收之后-进入survivor幸存区-来回复制
    3.  多次垃圾回收之后-进入old去<img src="/images/blog/image-20200514211600983.png" alt="illustration" class="my-4" /><img src="/images/blog/image-20200514214712694.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514212726203.png" alt="illustration" class="my-4" /></p><p><li> 什么情况下-栈上分配（无需人工调整）</li>
    1.  线程私有的小对象
    2.  无逃逸：只在某一段代码使用-没有被外部引用所引用<img src="/images/blog/image-20200514213900741.png" alt="illustration" class="my-4" />
    3.  支持标量替换：用普通属性代替整个对象
<li> 什么情况下-线程本地分配TLAB</li>
    1.  每个线程在eden取1%的空间-分配对象时-优先往这块空间分配</p><p>###### 何时进入老年代</p><p><img src="/images/blog/image-20200514213945581.png" alt="illustration" class="my-4" /></p><p><li> Mark word对象头中-GC的Age是4位-最大15-不能调大</li>
<li> Eden + S1 进入S2-超过S2的50%-年龄最大的放进Old<img src="/images/blog/image-20200514214444383.png" alt="illustration" class="my-4" /></li></p><p><img src="/images/blog/%E5%AF%B9%E8%B1%A1%E5%88%86%E9%85%8D%E8%BF%87%E7%A8%8B%E8%AF%A6%E8%A7%A3.png" alt="illustration" class="my-4" /></p><p><li> 动态年龄：（不重要）  </li>
    <a href="https://www.jianshu.com/p/989d3b06a49d">https://www.jianshu.com/p/989d3b06a49d</a>
<li> 分配担保：（不重要）  </li>
    YGC期间 survivor区空间不够了 空间担保直接进入老年代  
    参考：<a href="https://cloud.tencent.com/developer/article/1082730">https://cloud.tencent.com/developer/article/1082730</a></p><p>#### 5.常见的垃圾回收器</p><p><img src="/images/blog/image-20200514225853468.png" alt="illustration" class="my-4" /></p><p>JDK诞生 Serial(单线程)第一个诞生 提高效率-诞生了PS-为了配合CMS-诞生了PN-CMS是1.4版本后期引入-CMS是里程碑式的GC-它开启了并发回收的过程-但是CMS毛病较多-因此目前任何一个JDK版本默认是CMS  
并发垃圾回收是因为无法忍受STW</p><p>常见组合：这些逻辑上-物理上都分代  
<img src="/images/blog/image-20200514221637508.png" alt="illustration" class="my-4" /></p><p>G1：只在逻辑上分代</p><p><li> Serial(单线程) 年轻`,
    author: defaultAuthor,
    readTime: '78 min read',
    relatedPosts: ["2020-05-13-java"],
  },
  {
    title: "Spring Cloud: Eureka & Actuator Basics",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-06-23-spring-cloud-eurekaactuator',
    date: 'June 23, 2020',
    category: 'Distributed Systems',
    tags: ["Spring Cloud","Framework","Microservices"],
    slug: '2020-06-23-spring-cloud-eurekaactuator',
    content: `<p><h2>Spring Cloud</h2></p><p>Spring Cloud 自 2016 年 1 月发布第一个 Angel.SR5 版本-到目前 2020 年 3 月发布 Hoxton.SR3 版本-已经历经了 4 年时间。这 4 年时间里-Spring Cloud 一共发布了 46 个版本-支持的组件数从 5 个增加到 21 个。Spring Cloud 在 2019 年 12 月对外宣布后续 RoadMap：</p><p><li>下一个版本 Ilford 版本是一个大版本。这个版本基于 Spring Framework 5.3 & Spring Boot 2.4-会在 2020 Q4 左右发布；</li>
<li>Ilford 版本会删除处于维护模式的项目。目前处于维护模式的 Netflix 大部分项目都会被删除（spring-cloud-netflix Github 项目已经删除了这些维护模式的项目）；</li>
<li>简化 Spring Cloud 发布列车。后续 IaasS 厂商对应的 Spring Cloud 项目会移出 Spring Cloud 组织-各自单独维护（spring-cloud-azure 一直都是单独维护-spring-cloud-alibaba 孵化在 Spring Cloud 组织-毕业后单独维护）；</li>
<li>API 重构-会带来重大的改变（Spring Cloud Hoxton 版本新增了 Spring Cloud Circuit Breaker 用于统一熔断操作的编程模型和 Spring Cloud LoadBalanacer 用于处理客户端负载均衡并代替 Netflix Ribbon）。</li></p><p>这个 RoadMap 可以说是对 Spring Cloud 有着非常大的变化。</p><p><h3>SpringCloud替代实现</h3></p><p>!\<a href="Spring Cloud简介-Eureka和Actuator基本使用/1">img\</a></p><p><h3>SpringCloud Alibaba</h3></p><p><h2>组件</h2></p><p><strong><a href="https://github.com/alibaba/Sentinel">Sentinel</a></strong>：把流量作为切入点-从流量控制、熔断降级、系统负载保护等多个维度保护服务的稳定性。</p><p><strong><a href="https://github.com/alibaba/Nacos">Nacos</a></strong>：一个更易于构建云原生应用的动态服务发现、配置管理和服务管理平台。</p><p><strong><a href="https://rocketmq.apache.org/">RocketMQ</a></strong>：一款开源的分布式消息系统-基于高可用分布式集群技术-提供低延时的、高可靠的消息发布与订阅服务。</p><p><strong><a href="https://github.com/apache/dubbo">Dubbo</a></strong>：Apache Dubbo™ 是一款高性能 Java RPC 框架。</p><p><strong><a href="https://github.com/seata/seata">Seata</a></strong>：阿里巴巴开源产品-一个易于使用的高性能微服务分布式事务解决方案。</p><p><strong><a href="https://www.aliyun.com/product/acm">Alibaba Cloud ACM</a></strong>：一款在分布式架构环境中对应用配置进行集中管理和推送的应用配置中心产品。</p><p><strong><a href="https://www.aliyun.com/product/oss">Alibaba Cloud OSS</a></strong>: 阿里云对象存储服务（Object Storage Service-简称 OSS）-是阿里云提供的海量、安全、低成本、高可靠的云存储服务。您可以在任何应用、任何时间、任何地点存储和访问任意类型的数据。</p><p><strong><a href="https://help.aliyun.com/document_detail/43136.html">Alibaba Cloud SchedulerX</a></strong>: 阿里中间件团队开发的一款分布式任务调度产品-提供秒级、精准、高可靠、高可用的定时（基于 Cron 表达式）任务调度服务。</p><p><strong><a href="https://www.aliyun.com/product/sms">Alibaba Cloud SMS</a></strong>: 覆盖全球的短信服务-友好、高效、智能的互联化通讯能力-帮助企业迅速搭建客户触达通道。</p><p><h2>第一阶段课程Spring Cloud技术点</h2></p><p>Eureka：服务注册与发现-用于服务管理。</p><p>Feign： web调用客户端-能够简化HTTP接口的调用。</p><p>Ribbon：基于客户端的负载均衡。</p><p>Hystrix：熔断降级-防止服务雪崩。</p><p>Zuul：网关路由-提供路由转发、请求过滤、限流降级等功能。</p><p>Config：配置中心-分布式配置管理。</p><p>Sleuth：服务链路追踪</p><p>Admin：健康管理</p><p><h2>服务进化概述</h2></p><p><li> 传统服务到微服务进化。</li></p><p>    > 《传统到分布式演进》</p><p><li> 单体应用-> SOA ->微服务（下面讲）</li></p><p>\`\`<code>plain
课外扩展：持续集成-持续部署-持续交付。集成:是指软件个人研发的部分向软件整体部分集成-以便尽早发现个人开发部分的问题；部署: 是代码尽快向可运行的开发/测试节交付-以便尽早测试；交付: 是指研发尽快向客户交付-以便尽早发现生产环境中存在的问题。   如果说等到所有东西都完成了才向下个环节交付-导致所有的问题只能在最后才爆发出来-解决成本巨大甚至无法解决。而所谓的持续-就是说每完成一个完整的部分-就向下个环节交付-发现问题可以马上调整。使问题不会放大到其他部分和后面的环节。   这种做法的核心思想在于：既然事实上难以做到事先完全了解完整的、正确的需求-那么就干脆一小块一小块的做-并且加快交付的速度和频率-使得交付物尽早在下个环节得到验证。早发现问题早返工。上面的3个持续-也都随着微服务的发展而发展-当架构师的同学-可以参考这种方式。持续集成的工具-向大家推荐：https://jenkins.io/doc/book/pipeline/
</code>\`<code></p><p><h3>单体应用</h3></p><p><li> 概念：所有功能全部打包在一起。应用大部分是一个war包或jar包。我参与网约车最开始架构是：一个乘客项目中有 用户、订单、消息、地图等功能。随着业务发展-功能增多-这个项目会越来越臃肿。</li>
<li> 好处：容易开发、测试、部署-适合项目初期试错。</li>
<li> 坏处：</li></p><p>    ​ 随着项目越来越复杂-团队不断扩大。坏处就显现出来了。
    - 复杂性高：代码多-十万行-百万行级别。加一个小功能-会带来其他功能的隐患-因为它们在一起。
    - 技术债务：人员流动-不坏不修-因为不敢修。
    - 持续部署困难：由于是全量应用-改一个小功能-全部部署-会导致无关的功能暂停使用。编译部署上线耗时长-不敢随便部署-导致部署频率低-进而又导致两次部署之间 功能修改多-越不敢部署-恶性循环。
    - 可靠性差：某个小问题-比如小功能出现OOM-会导致整个应用崩溃。
    - 扩展受限：只能整体扩展-无法按照需要进行扩展- 不能根据计算密集型（派单系统）和IO密集型（文件服务） 进行合适的区分。
    - 阻碍创新：单体应用是以一种技术解决所有问题-不容易引入新技术。但在高速的互联网发展过程中-适应的潮流是：用合适的语言做合适的事情。比如在单体应用中-一个项目用spring MVC-想换成spring boot-切换成本很高-因为有可能10万-百万行代码都要改-而微服务可以轻松切换-因为每个服务-功能简单-代码少。</p><p><h3>SOA</h3></p><p></code>\`<code>
对单体应用的改进：引入SOA（Service-Oriented Architecture）面向服务架构-拆分系统-用服务的流程化来实现业务的灵活性。服务间需要某些方法进行连接-面向接口等-它是一种设计方法-其中包含多个服务- 服务之间通过相互依赖最终提供一系列的功能。一个服务 通常以独立的形式存在于操作系统进程中。各个服务之间 通过网络调用。但是还是需要用些方法来进行服务组合-有可能还是个单体应用。
</code>\`<code></p><p>所以要引入微服务-是SOA思想的一种具体实践。</p><p>微服务架构 = 80%的SOA服务架构思想 + 100%的组件化架构思想</p><p><h3>微服务</h3></p><p>#### 微服务概况</p><p><li>无严格定义。</li>
<li>微服务是一种架构风格-将单体应用划分为小型的服务单元。</li>
<li>微服务架构是一种使用一系列粒度较小的服务来开发单个应用的方式；每个服务运行在自己的进程中；服务间采用轻量级的方式进行通信(通常是HTTP API)；这些服务是基于业务逻辑和范围-通过自动化部署的机制来独立部署的-并且服务的集中管理应该是最低限度的-即每个服务可以采用不同的编程语言编写-使用不同的数据存储技术。</li>
<li>英文定义：</li></p><p></code>\`<code>sh
看这篇文章：http://www.martinfowler.com/articles/microservices.html
</code>\`<code></p><p><li>小类比</li></p><p>  合久必分。分开后通信-独立部署-独立存储。</p><p></code>\`<code>sh
分封制：服从天子命令：服从服务管理。有为天子镇守疆土的义务：各自完成各自的一块业务。随从作战：服务调用。交纳贡献：分担流量压力。
</code>\`<code></p><p><li>段子（中台战略）</li></p><p></code>\`<code>plain
Q：大师大师-服务拆多了怎么办？A：那就再合起来。Q：那太没面子了。A：那就说跨过了微服务初级阶段-在做中台（自助建站系统）。
</code>\`<code></p><p>#### 微服务特性</p><p>独立运行在自己进程中。</p><p>一系列独立服务共同构建起整个系统。</p><p>一个服务只关注自己的独立业务。</p><p>轻量的通信机制RESTful API</p><p>使用不同语言开发</p><p>全自动部署机制</p><p>#### 微服务组件介绍</p><p>不局限与具体的微服务实现技术。</p><p><li>服务注册与发现：服务提供方将己方调用地址注册到服务注册中心-让服务调用方能够方便地找到自己；服务调用方从服务注册中心找到自己需要调用的服务的地址。</li>
<li>负载均衡：服务提供方一般以多实例的形式提供服务-负载均衡功能能够让服务调用方连接到合适的服务节点。并且-服务节点选择的过程对服务调用方来说是透明的。</li>
<li>服务网关：服务网关是服务调用的唯一入口-可以在这个组件中实现用户鉴权、`,
    author: defaultAuthor,
    readTime: '40 min read',
    relatedPosts: ["2020-07-02","2020-07-23"],
  },
  {
    title: "Distributed Transaction Solutions",
    excerpt: "Comprehensive overview of distributed transaction patterns including 2PC, TCC, Saga, and eventual consistency implementations.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-07-02',
    date: 'July 2, 2020',
    category: 'Distributed Systems',
    tags: ["Distributed","Distributed Transaction","Summary"],
    slug: '2020-07-02',
    content: `<p><h1>分布式事务</h1></p><p><strong>事务（Transaction）</strong>-一般是指要做的或所做的事情-由<strong>事务开始(begin transaction)</strong>和<strong>事务结束(end transaction)</strong>之间执行的全体操作组成。</p><p><strong>简单的讲就是-要么全部被执行-要么就全部失败。</strong></p><p>那<strong>分布式事务</strong>-自然就是运行在分布式系统中的事务-是由<strong>多个不同的机器上的事务组合而成</strong>的。同上-只有分布式系统中所有事务执行了才能是成功-否则失败。</p><p>事务的基本特征ACID：</p><p><li>原子性（Atomicity）</li>
  - 一个事务是一个不可分割的工作单位-事务中包括的诸操作要么都做-要么都不做。
<li>一致性</li>
  - 指事务执行前和执行后-数据是完整的。
<li>隔离性</li>
  - 一个事务的执行不能被其他事务干扰。即一个事务内部的操作及使用的数据对并发的其他事务是隔离的-并发执行的各个事务之间不能互相干扰。
<li>持久性</li>
  - 也称为永久性-一个事务一旦提交-它对数据库中数据的改变就应该是永久性的保存下来了。</p><p>---</p><p><strong>分布式事务的目标：解决多个独立事务一致性的问题。</strong></p><p>我们遇到的问题：</p><p>分布式事务：一个功能-横跨多个微服务-由于每个微服务不在一个库-没法用数据库事务来保证事务。</p><p>网约车例子：乘客支付订单。支付系统中-支付表更新-订单系统-订单库 订单状态更新为已支付。</p><p>订单-支付表-在不同的库-如何保证两个库之间的事务。</p><p>支付操作：支付修改余额-修改订单状态。</p><p><h2>分布式事务解决方案</h2></p><p><h3>二阶段提交协议</h3></p><p>基于XA协议的-采取强一致性-遵从ACID.</p><p>2PC：（2阶段提交协议）-是基于XA/JTA规范。</p><p>#### XA</p><p>XA是由X/Open组织提出的分布式事务的架构（或者叫协议）。XA架构主要定义了（全局）事务管理器（Transaction Manager）和（局部）资源管理器（Resource Manager）之间的接口。XA接口是双向的系统接口-在事务管理器（Transaction Manager）以及一个或多个资源管理器（Resource Manager）之间形成通信桥梁。也就是说-在基于XA的一个事务中-我们可以针对多个资源进行事务管理-例如一个系统访问多个数据库-或即访问数据库、又访问像消息中间件这样的资源。这样我们就能够实现在多个数据库和消息中间件直接实现全部提交、或全部取消的事务。XA规范不是java的规范-而是一种通用的规范。</p><p>#### JTA</p><p>JTA(Java Transaction API)-是J2EE的编程接口规范-它是XA协议的JAVA实现。它主要定义了：</p><p>一个事务管理器的接口javax.transaction.TransactionManager-定义了有关事务的开始、提交、撤回等操作。  
一个满足XA规范的资源定义接口javax.transaction.xa.XAResource-一种资源如果要支持JTA事务-就需要让它的资源实现该XAResource接口-并实现该接口定义的两阶段提交相关的接口。</p><p>> 《二阶段提交协议》<img src="/images/blog/%E4%BA%8C%E9%98%B6%E6%AE%B5%E6%8F%90%E4%BA%A4%E5%8D%8F%E8%AE%AE.png" alt="illustration" class="my-4" /></p><p>#### 过程</p><p>\`\`<code>sh
1.请求阶段（commit-request phase-或称表决阶段-voting phase）在请求阶段-协调者将通知事务参与者准备提交或取消事务-然后进入表决过程。在表决过程中-参与者将告知协调者自己的决策：同意（事务参与者本地作业执行成功）或取消（本地作业执行故障）。2.提交阶段（commit phase）在该阶段-协调者将基于第一个阶段的投票结果进行决策：提交或取消。当且仅当所有的参与者同意提交事务协调者才通知所有的参与者提交事务-否则协调者将通知所有的参与者取消事务。参与者在接收到协调者发来的消息后将执行响应的操作。
</code>\`<code></p><p>#### 缺点：</p><p><li><strong>单点故障</strong>：事务的发起、提交还是取消-均是由老大协调者管理的-只要协调者宕机-那就凉凉了。</li>
<li><strong>同步阻塞缺点</strong>：从上面介绍以及例子可看出-我们的参与系统中在没收到老大的真正提交还是取消事务指令的时候-就是锁定当前的资源-并不真正的做些事务相关操作-所以-整个分布式系统环境就是阻塞的。</li>
<li><strong>数据不一致缺点</strong>：就是说在老大协调者向小弟们发送真正提交事务的时候-部分网路故障-造成部分系统没收到真正的指令-那么就会出现部分提交部分没提交-因此-这就会导致数据的不一致。</li></p><p>#### 无法解决的问题</p><p>当协调者出错-同时参与者也出错时-两阶段无法保证事务执行的完整性。  
考虑协调者再发出commit消息之后宕机-而唯一接收到这条消息的参与者同时也宕机了。  
那么即使有了新的协调者-这条事务的状态也是不确定的-没人知道事务是否被已经提交。知道的人已经被灭口了。</p><p><h3>三阶段提交协议</h3></p><p>采取强一致性-遵从ACID。</p><p>在二阶段上增加了：超时和预提交机制。</p><p>有这三个主阶段-canCommit、preCommit、doCommit这三个阶段</p><p>> 《三阶段提交协议》<img src="/images/blog/%E4%B8%89%E9%98%B6%E6%AE%B5%E6%8F%90%E4%BA%A4%E5%8D%8F%E8%AE%AE.png" alt="illustration" class="my-4" /></p><p>#### 流程</p><p></code>\`<code>sh
1.CanCommit阶段3PC的CanCommit阶段其实和2PC的准备阶段很像。协调者向参与者发送commit请求-参与者如果可以提交就返回Yes响应-否则返回No响应。2.PreCommit阶段Coordinator根据Cohort的反应情况来决定是否可以继续事务的PreCommit操作。根据响应情况-有以下两种可能。A.假如Coordinator从所有的Cohort获得的反馈都是Yes响应-那么就会进行事务的预执行：发送预提交请求。Coordinator向Cohort发送PreCommit请求-并进入Prepared阶段。事务预提交。Cohort(一群大兵)接收到PreCommit请求后-会执行事务操作-并将undo和redo信息记录到事务日志中。响应反馈。如果Cohort成功的执行了事务操作-则返回ACK响应-同时开始等待最终指令。B.假如有任何一个Cohort向Coordinator发送了No响应-或者等待超时之后-Coordinator都没有接到Cohort的响应-那么就中断事务：发送中断请求。Coordinator向所有Cohort发送abort请求。中断事务。Cohort收到来自Coordinator的abort请求之后（或超时之后-仍未收到Cohort的请求）-执行事务的中断。3.DoCommit阶段该阶段进行真正的事务提交-也可以分为以下两种情况:执行提交A.发送提交请求。Coordinator接收到Cohort发送的ACK响应-那么他将从预提交状态进入到提交状态。并向所有Cohort发送doCommit请求。B.事务提交。Cohort接收到doCommit请求之后-执行正式的事务提交。并在完成事务提交之后释放所有事务资源。C.响应反馈。事务提交完之后-向Coordinator发送ACK响应。D.完成事务。Coordinator接收到所有Cohort的ACK响应之后-完成事务。中断事务协调者没有接收到参与者发送的ACK响应-那么就执行中断事务。A.发送中断请求协调者向所有参与者发送abort请求B.事务回滚参与者接收到abort请求之后-利用其在阶段二记录的undo信息来执行事务的回滚操作-并在完成回滚之后释放所有的事务资源。C.反馈结果参与者完成事务回滚之后-向协调者发送ACK消息D.中断事务协调者接收到参与者反馈的ACK消息之后-执行事务的中断。
</code>\`<code></p><p>#### 缺点</p><p>如果进入PreCommit后-Coordinator发出的是abort请求-假设只有一个Cohort收到并进行了abort操作-  
而其他对于系统状态未知的Cohort会根据3PC选择继续Commit-此时系统状态发生不一致性。</p><p>#### 2和3 的区别</p><p>加了询问-增大成功概率。</p><p>对于协调者(Coordinator)和参与者(Cohort)都设置了超时机制（在2PC中-只有协调者拥有超时机制-即如果在一定时间内没有收到cohort的消息则默认失败）。协调者挂了-参与者等待超时后-默认提交事务。有一丢进步。</p><p>如果参与者异常了-协调者也异常了-会造成其他参与者提交。</p><p>在2PC的准备阶段和提交阶段之间-插入预提交阶段-使3PC拥有CanCommit、PreCommit、DoCommit三个阶段。  
PreCommit是一个缓冲-保证了在最后提交阶段之前各参与节点的状态是一致的。</p><p><h3>基于消息的最终一致性形式</h3></p><p>采取最终一致性-遵从BASE理论。</p><p><strong>BASE</strong>：全称是-Basically Avaliable（基本可用）-Soft state（软状态）-Eventually consistent（最终一致性）三个短语的缩写-来自eBay的架构师提出。</p><p><li><strong>Basically Avaliable：</strong>就是在分布式系统环境中-允许牺牲掉部分不影响主流程的功能的不可用-将其降级以确保核心服务的正常可用。</li>
<li><strong>Soft state：</strong>就是指在事务中-我们允许系统存在中间状态-且并不影响我们这个系统。就拿数据库的主从复制来说-是完全允许复制的时候有延时的发生的。</li>
<li><strong>Eventually consistent：</strong>还是以数据库主从复制为例说-虽然主从复制有小延迟-但是很快最终就数据保持一致了。</li></p><p>分布式事务不可能100%解决-只能提高成功概率。两阶段之间时间-毫秒级别。</p><p>补救措施：</p><p>定时任务补偿。程序或脚本补偿。</p><p>人工介入。</p><p><h3>TCC</h3></p><p>解决方案：TCC（Try、Confirm、Cancel）-两阶段补偿型方案。</p><p>从名字可以看出-实现一个事务-需要定义三个API：预先占有资源-确认提交实际操作资源-取消占有=回滚。</p><p>如果后两个环节执行一半失败了-记录日志-补偿处理-通知人工。</p><p></code>\`<code>sh
2PC：是资源层面的分布式事务`,
    author: defaultAuthor,
    readTime: '44 min read',
    relatedPosts: ["2020-06-23-spring-cloud-eurekaactuator","2020-07-23"],
  },
  {
    title: "MySQL Performance Tuning",
    excerpt: "Complete MySQL tuning guide covering query optimization, index strategies, configuration parameters, and performance monitoring.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-07-03-mysql',
    date: 'July 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-07-03-mysql',
    content: `<p><h2>MySQL调优</h2></p><p>#### 1\. 性能监控</p><p>show profile</p><p>此工具默认是禁用的-可以通过服务器变量在绘画级别动态的修改</p><p><strong>set profiling=1;</strong></p><p>当设置完成之后-在服务器上执行的所有语句-都会测量其耗费的时间和其他一些查询执行状态变更相关的数据。</p><p><strong>select \* from emp;</strong></p><p>在mysql的命令行模式下只能显示两位小数的时间-可以使用如下命令查看具体的执行时间</p><p><strong>show profiles;</strong></p><p>执行如下命令可以查看详细的每个步骤的时间：</p><p><strong>show profile for query 1;</strong></p><p><img src="/images/blog/image-20200412073731890.png" alt="illustration" class="my-4" /></p><p>show profiles 查看执行时间  
<img src="/images/blog/image-20200412074008668.png" alt="illustration" class="my-4" /></p><p>只精确到后两位</p><p>show profile 最近执行的sql , 每个步骤多长时间  
<img src="/images/blog/image-20200412074108964.png" alt="illustration" class="my-4" /></p><p>show profile for query 2 查第二个  
<img src="/images/blog/image-20200412074312622.png" alt="illustration" class="my-4" /></p><p>show profile cpu  
<img src="/images/blog/image-20200412074403265.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200412075426618.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200412075506666.png" alt="illustration" class="my-4" /></p><p><strong>各连接池性能</strong></p><p><img src="/images/blog/image-20200412081803049.png" alt="illustration" class="my-4" /></p><p>#### 2\. 表结构优化</p><p><img src="/images/blog/image-20200412082617475.png" alt="illustration" class="my-4" /></p><p>应该尽量使用可以正确存储数据的最小数据类型-更小的数据类型通常更快-因为它们占用更少的磁盘、内存和CPU缓存-并且处理时需要的CPU周期更少-但是要确保没有低估需要存储的值的范围-如果无法确认哪个数据类型-就选择你认为不会超过范围的最小类型</p><p>案例：</p><p>设计两张表-设计不同的数据类型-查看表的容量</p><p>\`\`<code>java
import java.sql.Connection;import java.sql.DriverManager;import java.sql.PreparedStatement;public class Test {    public static void main(String[] args) throws Exception{        Class.forName("com.mysql.jdbc.Driver");        Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/db1","root","123456");        PreparedStatement pstmt = conn.prepareStatement("insert into psn2 values(?,?)");        for (int i = 0; i < 20000; i++) {            pstmt.setInt(1,i);            pstmt.setString(2,i+"");            pstmt.addBatch();        }        pstmt.executeBatch();        conn.close();    }}
</code>\`<code></p><p><img src="/images/blog/image-20200412082918434.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200412083305650.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200412083622460.png" alt="illustration" class="my-4" /></p><p>bigint tinyint 占用空间不同 查询时间也不同</p><p><img src="/images/blog/image-20200412083557968.png" alt="illustration" class="my-4" /></p><p>ip地址转数值 INET_ATON/NTOA</p><p><img src="/images/blog/image-20200412083813449.png" alt="illustration" class="my-4" /></p><p>简单数据类型的操作通常需要更少的CPU周期-例如-</p><p>1、整型比字符操作代价更低-因为字符集和校对规则是字符比较比整型比较更复杂-</p><p>2、使用mysql自建类型而不是字符串来存储日期和时间</p><p>3、用整型存储IP地址</p><p>案例：</p><p>创建两张相同的表-改变日期的数据类型-查看SQL语句执行的速度</p><p><img src="/images/blog/image-20200412084513504.png" alt="illustration" class="my-4" /></p><p>如果查询中包含可为NULL的列-对mysql来说很难优化-因为可为null的列使得索引、索引统计和值比较都更加复杂-坦白来说-通常情况下null的列改为not null带来的性能提升比较小-所有没有必要将所有的表的schema进行修改-但是应该尽量避免设计成可为null的列</p><p><img src="/images/blog/image-20200412095640260.png" alt="illustration" class="my-4" /></p><p>可以使用的几种整数类型：TINYINT-SMALLINT-MEDIUMINT-INT-BIGINT分别使用8-16-24-32-64位存储空间。</p><p>尽量使用满足需求的最小数据类型</p><p><img src="/images/blog/image-20200412095744196.png" alt="illustration" class="my-4" /></p><p>1、char长度固定-即每条数据占用等长字节空间；最大长度是255个字符-适合用在身份证号、手机号等定长字符串</p><p>2、varchar可变程度-可以设置最大长度；最大空间是65535个字节-适合用在长度可变的属性</p><p>3、text不设置长度-当不知道属性的最大长度时-适合用text</p><p>按照查询速度：char>varchar>text</p><p><img src="/images/blog/image-20200412095833983.png" alt="illustration" class="my-4" /></p><p>4k对齐</p><p><img src="/images/blog/image-20200412100159575.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200412100534927.png" alt="illustration" class="my-4" /></p><p>MySQL 把每个 BLOB 和 TEXT 值当作一个独立的对象处理。</p><p>两者都是为了存储很大数据而设计的字符串类型-分别采用二进制和字符方式存储。</p><p><img src="/images/blog/image-20200412100615434.png" alt="illustration" class="my-4" /></p><p>1、不要使用字符串类型来存储日期时间数据</p><p>2、日期时间类型通常比字符串占用的存储空间小</p><p>3、日期时间类型在进行查找过滤时可以利用日期来进行比对</p><p>4、日期时间类型还有着丰富的处理函数-可以方便的对时间类型进行日期计算</p><p>5、使用int存储日期时间不如使用timestamp类型</p><p><img src="/images/blog/image-20200412101944180.png" alt="illustration" class="my-4" /></p><p>有时可以使用枚举类代替常用的字符串类型-mysql存储枚举类型会非常紧凑-会根据列表值的数据压缩到一个或两个字节中-mysql在内部会将每个值在列表中的位置保存为整数-并且在表的.frm文件中保存“数字-字符串”映射关系的查找表</p><p>create table enum_test(e enum(‘fish’,’apple’,’dog’) not null);</p><p>insert into enum_test(e) values(‘fish’),(‘dog’),(‘apple’);</p><p>select e+0 from enum_test;</p><p><img src="/images/blog/image-20200412101924672.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200412102018401.png" alt="illustration" class="my-4" /></p><p>人们经常使用varchar(15)来存储ip地址-然而-它的本质是32位无符号整数不是字符串-可以使用INET_ATON()和INET_NTOA函数在这两种表示方法之间转换</p><p>案例：</p><p>select inet_aton(‘1.1.1.1’)</p><p>select inet_nt`,
    author: defaultAuthor,
    readTime: '39 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "Spring AOP Basics",
    excerpt: "Master Aspect-Oriented Programming in Spring including pointcuts, advice types, annotations, and practical cross-cutting concern examples.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-07-04-spring-aop',
    date: 'July 4, 2020',
    category: 'Spring',
    tags: ["Framework","Spring","AOP"],
    slug: '2020-07-04-spring-aop',
    content: `<p><h1>Spring AOP介绍与使用</h1></p><p>AOP：Aspect Oriented Programming 面向切面编程</p><p>OOP：Object Oriented Programming 面向对象编程</p><p>​ 面向切面编程：基于OOP基础之上新的编程思想-OOP面向的主要对象是类-而AOP面向的主要对象是切面-在处理日志、安全管理、事务管理等方面有非常重要的作用。AOP是Spring中重要的核心点-虽然IOC容器没有依赖AOP-但是AOP提供了非常强大的功能-用来对IOC做补充。通俗点说的话就是在程序运行期间-将<strong>某段代码动态切入</strong>到<strong>指定方法</strong>的<strong>指定位置</strong>进行运行的这种编程方式。</p><p><h3>1、AOP的概念</h3></p><p>##### 为什么要引入AOP?</p><p>Calculator.java</p><p>\`\`<code>java
package com.oi.inter;public interface Calculator {    public int add(int i,int j);    public int sub(int i,int j);    public int mult(int i,int j);    public int div(int i,int j);}
</code>\`<code></p><p>MyCalculator.java</p><p></code>\`<code>java
package com.oi.inter;public class MyCalculator implements Calculator {    public int add(int i, int j) {        int result = i + j;        return result;    }    public int sub(int i, int j) {        int result = i - j;        return result;    }    public int mult(int i, int j) {        int result = i * j;        return result;    }    public int div(int i, int j) {        int result = i / j;        return result;    }}
</code>\`<code></p><p>MyTest.java</p><p></code>\`<code>java
public class MyTest {    public static void main(String[] args) throws SQLException {        MyCalculator myCalculator = new MyCalculator();        System.out.println(myCalculator.add(1, 2));    }}
</code>\`<code></p><p>​ 此代码非常简单-就是基础的javase的代码实现-此时如果需要添加日志功能应该怎么做呢-只能在每个方法中添加日志输出-同时如果需要修改的话会变得非常麻烦。</p><p>MyCalculator.java</p><p></code>\`<code>java
package com.oi.inter;public class MyCalculator implements Calculator {    public int add(int i, int j) {        System.out.println("add 方法开始执行-参数为："+i+","+j);        int result = i + j;        System.out.println("add 方法开始完成结果为："+result);        return result;    }    public int sub(int i, int j) {        System.out.println("sub 方法开始执行-参数为："+i+","+j);        int result = i - j;        System.out.println("add 方法开始完成结果为："+result);        return result;    }    public int mult(int i, int j) {        System.out.println("mult 方法开始执行-参数为："+i+","+j);        int result = i * j;        System.out.println("add 方法开始完成结果为："+result);        return result;    }    public int div(int i, int j) {        System.out.println("div 方法开始执行-参数为："+i+","+j);        int result = i / j;        System.out.println("add 方法开始完成结果为："+result);        return result;    }}
</code>\`<code></p><p>​ 可以考虑将日志的处理抽象出来-变成工具类来进行实现：</p><p>LogUtil.java</p><p></code>\`<code>java
package com.oi.util;import java.util.Arrays;public class LogUtil {    public static void start(Object ... objects){        System.out.println("XXX方法开始执行-使用的参数是："+ Arrays.asList(objects));    }    public static void stop(Object ... objects){        System.out.println("XXX方法执行结束-结果是："+ Arrays.asList(objects));    }}
</code>\`<code></p><p>MyCalculator.java</p><p></code>\`<code>java
package com.oi.inter;import com.oi.util.LogUtil;public class MyCalculator implements Calculator {    public int add(int i, int j) {        LogUtil.start(i,j);        int result = i + j;        LogUtil.stop(result);        return result;    }    public int sub(int i, int j) {        LogUtil.start(i,j);        int result = i - j;        LogUtil.stop(result);        return result;    }    public int mult(int i, int j) {        LogUtil.start(i,j);        int result = i * j;        LogUtil.stop(result);        return result;    }    public int div(int i, int j) {        LogUtil.start(i,j);        int result = i / j;        LogUtil.stop(result);        return result;    }}
</code>\`<code></p><p>​ 按照上述方式抽象之后-代码确实简单很多-但是大家应该已经发现在输出的信息中并不包含具体的方法名称-我们更多的是想要在程序运行过程中动态的获取方法的名称及参数、结果等相关信息-此时可以通过使用<strong>动态代理</strong>的方式来进行实现。</p><p>CalculatorProxy.java</p><p></code>\`<code>java
package com.oi.proxy;import com.oi.inter.Calculator;import java.lang.reflect.InvocationHandler;import java.lang.reflect.InvocationTargetException;import java.lang.reflect.Method;import java.lang.reflect.Proxy;import java.util.Arrays;/<strong> * 帮助Calculator生成代理对象的类 */public class CalculatorProxy {    /</strong>     *     *  为传入的参数对象创建一个动态代理对象     * @param calculator 被代理对象     * @return     */    public static Calculator getProxy(final Calculator calculator){        //被代理对象的类加载器        ClassLoader loader = calculator.getClass().getClassLoader();        //被代理对象的接口        Class[] interfaces = calculator.getClass().getInterfaces();        //方法执行器-执行被代理对象的目标方法        InvocationHandler h = new InvocationHandler() {            /**             *  执行目标方法             * @param proxy 代理对象-给jdk使用-任何时候都不要操作此对象             * @param method 当前将要执行的目标对象的方法             * @param args 这个方法调用时外界传入的参数值             * @return             * @throws Throwable             */            public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {                //利用反射执行目标方法,目标方法执行后的返回值//                System.out.println("这是动态代理执行的方法");                Object result = null;                try {                    System.out.println(method.getName()+"方法开始执行-参数是`,
    author: defaultAuthor,
    readTime: '74 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "ActiveMQ Deep Dive",
    excerpt: "Complete ActiveMQ guide covering JMS concepts, message patterns, persistence, clustering, and integration with Spring.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-07-12-activemq',
    date: 'July 12, 2020',
    category: 'Backend',
    tags: ["Message Queue","ActiveMQ"],
    slug: '2020-07-12-activemq',
    content: `<p><h1>1\. 详细介绍</h1></p><p><h2>什么是JMS MQ</h2></p><p>全称：Java MessageService 中文：Java 消息服务。</p><p>JMS 是 Java 的一套 API 标准-最初的目的是为了使应用程序能够访问现有的 MOM 系 统（MOM 是 MessageOriented Middleware 的英文缩写-指的是利用高效可靠的消息传递机 制进行平台无关的数据交流-并基于数据通信来进行分布式系统的集成。） ；</p><p>后来被许多现有 的 MOM 供应商采用-并实现为 MOM 系统。【常见 MOM 系统包括 Apache 的 ActiveMQ、 阿里巴巴的 RocketMQ、IBM 的 MQSeries、Microsoft 的 MSMQ、BEA 的 RabbitMQ 等。 （并 非全部的 MOM 系统都遵循 JMS 规范）】</p><p>基于 JMS 实现的 MOM-又被称为 JMSProvider。</p><p>“消息”是在两台计算机间传送的数据单位。消息可以非常简单-例如只包含文本字符串； 也可以更复杂-可能包含嵌入对象。 消息被发送到队列中。</p><p>“消息队列”是在消息的传输过程中保存消息的容器。消息队列管 理器在将消息从它的源中继到它的目标时充当中间人。</p><p>队列的主要目的是提供路由并保证消 息的传递；如果发送消息时接收者不可用-消息队列会保留消息-直到可以成功地传递它。</p><p>消息队列的主要特点是异步处理-主要目的是减少请求响应时间和解耦。所以主要的使 用场景就是将比较耗时而且不需要即时（同步）返回结果的操作作为消息放入消息队列。同 时由于使用了消息队列-只要保证消息格式不变-消息的发送方和接收方并不需要彼此联系- 也不需要受对方的影响-即解耦和。如: 跨系统的异步通信-所有需要异步交互的地方都可以使用消息队列。就像我们除了打电 话（同步）以外-还需要发短信-发电子邮件（异步）的通讯方式。 多个应用之间的耦合-由于消息是平台无关和语言无关的-而且语义上也不再是函数调 用-因此更适合作为多个应用之间的松耦合的接口。基于消息队列的耦合-不需要发送方和 接收方同时在线。 在企业应用集成（EAI）中-文件传输-共享数据库-消息队列-远程过程调用都可以 作为集成的方法。 应用内的同步变异步-比如订单处理-就可以由前端应用将订单信息放到队列-后端应 用从队列里依次获得消息处理-高峰时的大量订单可以积压在队列里慢慢处理掉。由于同步 通常意味着阻塞-而大量线程的阻塞会降低计算机的性能。 消息驱动的架构（EDA）-系统分解为消息队列-和消息制造者和消息消费者-一个处 理流程可以根据需要拆成多个阶段（Stage） -阶段之间用队列连接起来-前一个阶段处理的 结果放入队列-后一个阶段从队列中获取消息继续处理。 应用需要更灵活的耦合方式-如发布订阅-比如可以指定路由规则。 跨局域网-甚至跨城市的通讯-比如北京机房与广州机房的应用程序的通信。</p><p><h2>消息中间件应用场景</h2></p><p><h3><strong>异步通信</strong></h3></p><p>有些业务不想也不需要立即处理消息。消息队列提供了异步处理机制-允许用户把一个消息放入队列-但并不立即处理它。想向队列中放入多少消息就放多少-然后在需要的时候再去处理它们。</p><p><h3><strong>缓冲</strong></h3></p><p>在任何重要的系统中-都会有需要不同的处理时间的元素。消息队列通过一个缓冲层来帮助任务最高效率的执行-该缓冲有助于控制和优化数据流经过系统的速度。以调节系统响应时间。</p><p><h3><strong>解耦</strong></h3></p><p>降低工程间的强依赖程度-针对异构系统进行适配。在项目启动之初来预测将来项目会碰到什么需求-是极其困难的。通过消息系统在处理过程中间插入了一个隐含的、基于数据的接口层-两边的处理过程都要实现这一接口-当应用发生变化时-可以独立的扩展或修改两边的处理过程-只要确保它们遵守同样的接口约束。</p><p><h3><strong>冗余</strong></h3></p><p>有些情况下-处理数据的过程会失败。除非数据被持久化-否则将造成丢失。消息队列把数据进行持久化直到它们已经被完全处理-通过这一方式规避了数据丢失风险。许多消息队列所采用的”插入-获取-删除”范式中-在把一个消息从队列中删除之前-需要你的处理系统明确的指出该消息已经被处理完毕-从而确保你的数据被安全的保存直到你使用完毕。</p><p><h3><strong>扩展性</strong></h3></p><p>因为消息队列解耦了你的处理过程-所以增大消息入队和处理的频率是很容易的-只要另外增加处理过程即可。不需要改变代码、不需要调节参数。便于分布式扩容。</p><p><h3><strong>可恢复性</strong></h3></p><p>系统的一部分组件失效时-不会影响到整个系统。消息队列降低了进程间的耦合度-所以即使一个处理消息的进程挂掉-加入队列中的消息仍然可以在系统恢复后被处理。</p><p><h3><strong>顺序保证</strong></h3></p><p>在大多使用场景下-数据处理的顺序都很重要。大部分消息队列本来就是排序的-并且能保证数据会按照特定的顺序来处理。</p><p><h3><strong>过载保护</strong></h3></p><p>在访问量剧增的情况下-应用仍然需要继续发挥作用-但是这样的突发流量无法提取预知；如果以为了能处理这类瞬间峰值访问为标准来投入资源随时待命无疑是巨大的浪费。使用消息队列能够使关键组件顶住突发的访问压力-而不会因为突发的超负荷的请求而完全崩溃。</p><p><h3><strong>数据流处理</strong></h3></p><p>分布式系统产生的海量数据流-如：业务日志、监控数据、用户行为等-针对这些数据流进行实时或批量采集汇总-然后进行大数据分析是当前互联网的必备技术-通过消息队列完成此类数据收集是最好的选择。</p><p><h2>常用消息队列（ActiveMQ、RabbitMQ、RocketMQ、Kafka）比较</h2></p><p>特性MQ</p><p>ActiveMQ</p><p>RabbitMQ</p><p>RocketMQ</p><p>Kafka</p><p>生产者消费者模式</p><p>支持</p><p>支持</p><p>支持</p><p>支持</p><p>发布订阅模式</p><p>支持</p><p>支持</p><p>支持</p><p>支持</p><p>请求回应模式</p><p>支持</p><p>支持</p><p>不支持</p><p>不支持</p><p>Api完备性</p><p>高</p><p>高</p><p>高</p><p>高</p><p>多语言支持</p><p>支持</p><p>支持</p><p>java</p><p>支持</p><p>单机吞吐量</p><p>万级</p><p>万级</p><p>万级</p><p>十万级</p><p>消息延迟</p><p>无</p><p>微秒级</p><p>毫秒级</p><p>毫秒级</p><p>可用性</p><p>高（主从）</p><p>高（主从）</p><p>非常高（分布式）</p><p>非常高（分布式）</p><p>消息丢失</p><p>低</p><p>低</p><p>理论上不会丢失</p><p>理论上不会丢失</p><p>文档的完备性</p><p>高</p><p>高</p><p>高</p><p>高</p><p>提供快速入门</p><p>有</p><p>有</p><p>有</p><p>有</p><p>社区活跃度</p><p>高</p><p>高</p><p>有</p><p>高</p><p>商业支持</p><p>无</p><p>无</p><p>商业云</p><p>商业云</p><p><h2>JMS中的一些角色</h2></p><p><h3><strong>Broker</strong></h3></p><p>消息服务器-作为server提供消息核心服务</p><p><h3>provider</h3></p><p>生产者</p><p>消息生产者是由会话创建的一个对象-用于把消息发送到一个目的地。</p><p><h3>Consumer</h3></p><p>消费者</p><p>消息消费者是由会话创建的一个对象-它用于接收发送到目的地的消息。消息的消费可以采用以下两种方法之一：</p><p><li>同步消费。通过调用消费者的receive方法从目的地中显式提取消息。receive方法可以一直阻塞到消息到达。</li>
<li>异步消费。客户可以为消费者注册一个消息监听器-以定义在消息到达时所采取的动作。</li></p><p><h3>p2p</h3></p><p>基于点对点的消息模型</p><p>消息生产者生产消息发送到 queue 中-然后消息消费者从 queue 中取出并且消费消息。 消息被消费以后-queue 中不再有存储-所以消息消费者不可能消费到已经被消费的消  
息。  
Queue 支持存在多个消费者-但是对一个消息而言-只会有一个消费者可以消费、其它 的则不能消费此消息了。 当消费者不存在时-消息会一直保存-直到有消费消费</p><p><img src="/images/blog/image-20200110192535698.png" alt="illustration" class="my-4" /></p><p><h3>pub/sub</h3></p><p><img src="/images/blog/image-20200110192613518.png" alt="illustration" class="my-4" /></p><p>基于订阅/发布的消息模型</p><p>消息生产者（发布）将消息发布到 topic 中-同时有多个消息消费者（订阅）消费该消  
息。  
和点对点方式不同-发布到 topic 的消息会被所有订阅者消费。 当生产者发布消息-不管是否有消费者。都不会保存消息 一定要先有消息的消费者-后有消息的生产者。</p><p><h3>PTP 和 PUB/SUB 简单对</h3></p><p>1</p><p>Topic</p><p>Queue</p><p>Publish Subscribe messaging 发布 订阅消息</p><p>Point-to-Point 点对点</p><p>有无状态</p><p>topic 数据默认不落地-是无状态的。</p><p>Queue 数据默认会在 mq 服 务器上以文件形式保存-比如 Active MQ 一 般 保 存 在 \$AMQ_HOME\\data\\kahadb 下 面。也可以配置成 DB 存储。</p><p>完整性保障</p><p>并不保证 publisher 发布的每条数 据-Subscriber 都能接受到。</p><p>Queue 保证每条数据都能 被 receiver 接收。消息不超时。</p><p>消息是否会丢失</p><p>一般来说 publisher 发布消息到某 一个 topic 时-只有正在监听该 topic 地址的 sub 能够接收到消息；如果没 有 sub 在监听-该 topic 就丢失了。</p><p>Sender 发 送 消 息 到 目 标 Queue- receiver 可以异步接收这 个 Queue 上的消息。Queue 上的 消息如果暂时没有 receiver 来 取-也不会丢失。前提是消息不 超时。</p><p>消息发布接 收策略</p><p>一对多的消息发布接收策略-监 听同一个topic地址的多个sub都能收 到 publisher 发送的消息。Sub 接收完 通知 mq 服务器</p><p>一`,
    author: defaultAuthor,
    readTime: '157 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "MySQL Index Data Structure Analysis",
    excerpt: "Understanding MySQL index internals including B+ tree structure, page organization, and how indexes accelerate query performance.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-07-12-mysql',
    date: 'July 12, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-07-12-mysql',
    content: `<p><h2>二叉树、B-Tree、B+Tree、红黑树、平衡二叉树（AVL Trees）</h2></p><p><h3>平衡二叉树 (AVL Trees)</h3></p><p>  平衡二叉树是一种特殊的二叉树-所以他也满足前面说到的二叉树的两个特性-同时还有一个特性：</p><p>​ 它的左右两个子树的高度差的绝对值不超过1-并且左右两个子树都是一棵平衡二叉树。</p><p>  大家也看到了前面\[35 27 48 12 29 38 55\]插入完成后的图-其实就已经是一颗平衡二叉树。</p><p>  那如果按照\[12 27 29 35 38 48 55\]的顺序插入一颗平衡二叉树-会怎么样呢？我们看看插入以及平衡的过程：</p><p><img src="http://cdn.17coding.info/WeChat%20Screenshot_20190616165744.png" alt="illustration" class="my-4" /> <img src="http://cdn.17coding.info/WeChat%20Screenshot_20190616165806.png" alt="illustration" class="my-4" /> !\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190616165835.png">img\</a> !\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190616165909.png">img\</a> !\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190616165924.png">img\</a> !\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190616165936.png">img\</a> !\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190616165954.png">img\</a></p><p>  这棵树始终满足平衡二叉树的几个特性而保持平衡！这样我们的树也不会退化为线性链表了！我们需要查找一个数的时候就能沿着树根一直往下找-这样的查找效率和二分法查找是一样的呢！</p><p>  一颗平衡二叉树能容纳多少的结点呢？这跟树的高度是有关系的-假设树的高度为h-那每一层最多容纳的结点数量为2^(n-1)-整棵树最多容纳节点数为2^0+2^1+2^2+…+2^(h-1)。这样计算-100w数据树的高度大概在20左右-那也就是说从有着100w条数据的平衡二叉树中找一个数据-最坏的情况下需要20次查找。如果是内存操作-效率也是很高的！但是我们数据库中的数据基本都是放在磁盘中的-每读取一个二叉树的结点就是一次磁盘IO-这样我们找一条数据如果要经过20次磁盘的IO？那性能就成了一个很大的问题了！那我们是不是可以把这棵树压缩一下-让每一层能够容纳更多的节点呢？虽然我矮-但是我胖啊…</p><p><h3>B-Tree</h3></p><p>  这颗矮胖的树就是B-Tree-注意中间是杠精的杠而不是减-所以也不要读成B减Tree了~</p><p>  那B-Tree有哪些特性呢？一棵m阶的B-Tree有如下特性：</p><p>> 1、每个结点最多m个子结点。  
> 2、除了根结点和叶子结点外-每个结点最少有m/2（向上取整）个子结点。  
> 3、如果根结点不是叶子结点-那根结点至少包含两个子结点。  
> 4、所有的叶子结点都位于同一层。  
> 5、每个结点都包含k个元素（关键字）-这里m/2≤k<m-这里m/2向下取整。  
> 6、每个节点中的元素（关键字）从小到大排列。  
> 7、每个元素（关键字）字左结点的值-都小于或等于该元素（关键字）。右结点的值都大于或等于该元素（关键字）。</p><p>  是不是感觉跟丈母娘张口问你要彩礼一样-列一堆的条件-而且每一条都让你很懵逼！下面我们以一个\[0,1,2,3,4,5,6,7\]的数组插入一颗3阶的B-Tree为例-将所有的条件都串起来-你就明白了！</p><p>!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204220.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204227.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204243.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204302.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204311.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204327.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619204336.png">img\</a></p><p>  那么-你是否对B-Tree的几点特性都清晰了呢？在二叉树中-每个结点只有一个元素。但是在B-Tree中-每个结点都可能包含多个元素-并且非叶子结点在元素的左右都有指向子结点的指针。</p><p>  如果需要查找一个元素-那流程是怎么样的呢？我们看下图-如果我们要在下面的B-Tree中找到关键字24-那流程如下  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619210818.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619210824.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619210831.png">img\</a>  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190619210838.png">img\</a></p><p>  从这个流程我们能看出-B-Tree的查询效率好像也并不比平衡二叉树高。但是查询所经过的结点数量要少很多-也就意味着要少很多次的磁盘IO-这对  
性能的提升是很大的。</p><p>  前面对B-Tree操作的图我们能看出来-元素就是类似1、2、3这样的数值-但是数据库的数据都是一条条的数据-如果某个数据库以B-Tree的数据结构存储数据-那数据怎么存放的呢？我们看下一张图</p><p>!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190620221029.png">img\</a></p><p>  普通的B-Tree的结点中-元素就是一个个的数字。但是上图中-我们把元素部分拆分成了key-data的形式-key就是数据的主键-data就是具体的数据。这样我们在找一条数的时候-就沿着根结点往下找就ok了-效率是比较高的。</p><p><h3>B+Tree</h3></p><p>  B+Tree是在B-Tree基础上的一种优化-使其更适合实现外存储索引结构。B+Tree与B-Tree的结构很像-但是也有几个自己的特性：</p><p>> 1、所有的非叶子节点只存储关键字信息。  
> 2、所有卫星数据（具体数据）都存在叶子结点中。  
> 3、所有的叶子结点中包含了全部元素的信息。  
> 4、所有叶子节点之间都有一个链指针。</p><p>  如果上面B-Tree的图变成B+Tree-那应该如下：  
!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190621220003.png">img\</a></p><p>  大家仔细对比于B-Tree的图能发现什么不同？  
  1、非叶子结点上已经只有key信息了-满足上面第1点特性！  
  2、所有叶子结点下面都有一个data区域-满足上面第2点特性！  
  3、非叶子结点的数据在叶子结点上都能找到-如根结点的元素4、8在最底层的叶子结点上也能找到-满足上面第3点特性！  
  4、注意图中叶子结点之间的箭头-满足满足上面第4点特性！</p><p><h3>B-Tree or B+Tree？</h3></p><p>  在讲这两种数据结构在数据库中的选择之前-我们还需要了解的一个知识点是操作系统从磁盘读取数据到内存是以磁盘块（block）为基本单位的-<strong>位于同一个磁盘块中的数据会被一次性读取出来-而不是需要什么取什么</strong>。即使只需要一个字节-磁盘也会从这个位置开始-顺序向后读取一定长度的数据放入内存。这样做的理论依据是计算机科学中著名的<strong>局部性原理</strong>： 当一个数据被用到时-其附近的数据也通常会马上被使用。  
  预读的长度一般为页（page）的整倍数。页是计算机管理存储器的逻辑块-硬件及操作系统往往将主存和磁盘存储区分割为连续的大小相等的块-每个存储块称为一页（在许多操作系统中-页得大小通常为4k）。</p><p>  B-Tree和B+Tree该如何选择呢？都有哪些优劣呢？  
  1、B-Tree因为非叶子结点也保存具体数据-所以在查找某个关键字的时候找到即可返回。而B+Tree所有的数据都在叶子结点-每次查找都得到叶子结点。所以在同样高度的B-Tree和B+Tree中-B-Tree查找某个关键字的效率更高。  
  2、由于B+Tree所有的数据都在叶子结点-并且结点之间有指针连接-在找大于某个关键字或者小于某个关键字的数据的时候-B+Tree只需要找到该关键字然后沿着链表遍历就可以了-而B-Tree还需要遍历该关键字结点的根结点去搜索。  
  3、由于B-Tree的每个结点（这里的结点可以理解为一个数据页）都存储主键+实际数据-而B+Tree非叶子结点只存储关键字信息-而每个页的大小有限是有限的-所以同一页能存储的B-Tree的数据会比B+Tree存储的更少。这样同样总量的数据-B-Tree的深度会更大-增大查询时的磁盘I/O次数-进而影响查询效率。  
  鉴于以上的比较-所以在常用的关系型数据库中-都是选择B+Tree的数据结构来存储数据！下面我们以mysql的innodb存储引擎为例讲解-其他类似sqlserver、oracle的原理类似！</p><p>#### innodb引擎数据存储</p><p>  在InnoDB存储引擎中-也有页的概念-默认每个页的大小为16K-也就是每次读取数据时都是读取4\*4k的大小！假设我们现在有一个用户表-我们往里面写数据</p><p>!\<a href="MySQL索引数据结构分析/WeChat Screenshot_20190623130137.png">img\</a></p><p>  这里需要注意的一点是-在某个页内插入新行时-为了不减少数据的移动-通常是插入到当前行的后面或者是已删除行留下来的空间-所以在<strong>某一个页内</strong>的数据并<strong>不是完全有序</strong>的（后面页结构部分有细讲）-但是为了为了数据访问顺序性-在每个记录中都有一个指向下一条记录的指针-以此构成了一条单向有序链表-不过在这里为了方便演示我是按顺序排列的！</p><p>  由于数据还比较少-一个页就能容下-所以只有一个根结点-主键和数据也都`,
    author: defaultAuthor,
    readTime: '20 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "SpringBoot DataSource Configuration",
    excerpt: "Configure single and multiple data sources in Spring Boot with connection pooling, transaction management, and dynamic routing.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-07-12-springboot',
    date: 'July 12, 2020',
    category: 'Backend',
    tags: ["Spring Boot"],
    slug: '2020-07-12-springboot',
    content: `<p><h1>Spring Boot配置数据源</h1></p><p>​ Spring Framework 为 SQL 数据库提供了广泛的支持。从直接使用 JdbcTemplate 进行 JDBC 访问到完全的对象关系映射（object relational mapping）技术-比如 Hibernate。Spring Data 提供了更多级别的功能-直接从接口创建的 Repository 实现-并使用了约定从方法名生成查询。</p><p><h3>1、JDBC</h3></p><p>1、创建项目-导入需要的依赖</p><p>\`\`<code>xml
         org.springframework.boot         spring-boot-starter-jdbc              mysql         mysql-connector-java         runtime
</code>\`<code></p><p>2、配置数据源</p><p></code>\`<code>yaml
spring:  datasource:    username: root    password: 123456    url: jdbc:mysql://192.168.85.111:3306/sakila?serverTimezone=UTC&useUnicode=true@characterEncoding=utf-8    driver-class-name: com.mysql.jdbc.Driver
</code>\`<code></p><p>3、测试类代码</p><p></code>\`<code>java
package com.oi;import org.junit.jupiter.api.Test;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import javax.sql.DataSource;import java.sql.Connection;import java.sql.SQLException;@SpringBootTestclass DataApplicationTests {    @Autowired    DataSource dataSource;    @Test    void contextLoads() throws SQLException {        System.out.println(dataSource.getClass());        Connection connection = dataSource.getConnection();        System.out.println(connection);        connection.close();    }}//可以看到默认配置的数据源为class com.zaxxer.hikari.HikariDataSource-我们没有经过任何配置-说明springboot默认情况下支持的就是这种数据源-可以在DataSourceProperties.java文件中查看具体的属性配置
</code>\`<code></p><p>4、crud操作</p><p>​ 1、有了数据源(com.zaxxer.hikari.HikariDataSource)-然后可以拿到数据库连接(java.sql.Connection)-有了连接-就可以使用连接和原生的 JDBC 语句来操作数据库</p><p>​ 2、即使不使用第三方第数据库操作框架-如 MyBatis等-Spring 本身也对原生的JDBC 做了轻量级的封装-即 org.springframework.jdbc.core.JdbcTemplate。</p><p>​ 3、数据库操作的所有 CRUD 方法都在 JdbcTemplate 中。</p><p>​ 4、Spring Boot 不仅提供了默认的数据源-同时默认已经配置好了 JdbcTemplate 放在了容器中-程序员只需自己注入即可使用</p><p>​ 5、JdbcTemplate 的自动配置原理是依赖 org.springframework.boot.autoconfigure.jdbc 包下的 org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration 类</p><p></code>\`<code>java
package com.oi.contoller;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.web.bind.annotation.GetMapping;import org.springframework.web.bind.annotation.PathVariable;import org.springframework.web.bind.annotation.RestController;import java.util.List;import java.util.Map;@RestControllerpublic class JDBCController {    @Autowired    JdbcTemplate jdbcTemplate;    @GetMapping("/emplist")    public List> empList(){        String sql = "select * from emp";        List> maps = jdbcTemplate.queryForList(sql);        return maps;    }    @GetMapping("/addEmp")    public String addUser(){        String sql = "insert into emp(empno,ename) values(1111,'zhangsan')";        jdbcTemplate.update(sql);        return "success";    }    @GetMapping("/updateEmp/{id}")    public String updateEmp(@PathVariable("id") Integer id){        String sql = "update emp set ename=? where empno = "+id;        String name = "list";        jdbcTemplate.update(sql,name);        return "update success";    }    @GetMapping("/deleteEmp/{id}")    public String deleteEmp(@PathVariable("id")Integer id){        String sql = "delete from emp where empno = "+id;        jdbcTemplate.update(sql);        return "delete success";    }}
</code>\`<code></p><p><h3>2、自定义数据源DruidDataSource</h3></p><p>通过源码查看DataSourceAutoConfiguration.java</p><p></code>\`<code>java
@Configuration(proxyBeanMethods = false)@ConditionalOnClass({ DataSource.class, EmbeddedDatabaseType.class })@EnableConfigurationProperties(DataSourceProperties.class)@Import({ DataSourcePoolMetadataProvidersConfiguration.class, DataSourceInitializationConfiguration.class })public class DataSourceAutoConfiguration {	@Configuration(proxyBeanMethods = false)	@Conditional(EmbeddedDatabaseCondition.class)	@ConditionalOnMissingBean({ DataSource.class, XADataSource.class })	@Import(EmbeddedDataSourceConfiguration.class)	protected static class EmbeddedDatabaseConfiguration {	}	@Configuration(proxyBeanMethods = false)	@Conditional(PooledDataSourceCondition.class)	@ConditionalOnMissingBean({ DataSource.class, XADataSource.class })	@Import({ DataSourceConfiguration.Hikari.class, DataSourceConfiguration.Tomcat.class,			DataSourceConfiguration.Dbcp2.class, DataSourceConfiguration.Generic.class,			DataSourceJmxConfiguration.class })	protected static class PooledDataSourceConfiguration {	}	/**	 * {@link AnyNestedCondition} that checks that either {@code spring.datasource.type}	 * is set or {@link PooledDataSourceAvailableCondition} applies.	 */	static class PooledDataSourceCondition extends AnyNestedCondition {		PooledDataSourceCondition() {			super(ConfigurationPhase.PARSE_CONFIGURATION);		}		@ConditionalOnProperty(prefix = "spring.datasource", name = "type")		static class ExplicitType {		}		@Conditional(PooledDataSourceAvailableCondition.class)		static class PooledDataSourceAvailable {		}	}
</code>\`<code></p><p>1、添加druid的maven配置</p><p></code>\`<code>xml
    com.alib`,
    author: defaultAuthor,
    readTime: '57 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Spring MVC Source Code Analysis",
    excerpt: "Deep dive into Spring MVC internals covering DispatcherServlet, handler mappings, view resolvers, and request processing flow.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-07-15-spring-mvc',
    date: 'July 15, 2020',
    category: 'Spring',
    tags: ["Spring","Spring MVC"],
    slug: '2020-07-15-spring-mvc',
    content: `<p><h1>Spring MVC源码解析</h1></p><p>​ 在讲解springmvc之前-其实是需要大家了解一点tomcat的源码知识的-但是大部分的初学者还只停留在应用的层面-所以-下面展示tomcat容器初始化的流程图和加载servlet的流程图-大家只需要先记住他们的执行顺序即可-等后续开始tomcat源码之后我们再做下一步深入了解。</p><p>1、Tomcat容器初始化流程图</p><p>!\<a href="Spring MVC源码解析/tomcat容器初始化流程图.png">img\</a></p><p>2、tomcat加载servlet流程图</p><p>!\<a href="Spring MVC源码解析/加载servlet流程图.png">img\</a></p><p>从上述流程开始看起-我们发现最终会调用Servlet的init方法-SpringMVC中最核心的类就是DispatcherServlet-因此需要找到init方法。</p><p><h3>1、DispatcherServlet的初始化</h3></p><p>DispatcherServlet的类图：</p><p>!\<a href="Spring MVC源码解析/DispatcherServlet类图.png">image-20200314005616939\</a></p><p>​ 可以看到,DispatcherServlet继承自HttpServlet-它的本质就是一个Servlet-但是此类中并没有init方法-因此要去父类中进行查找-最终在HttpServletBean类中重写了父类GenericServlet的init方法。因此当tomcat容器启动的时候会调用init方法开始执行-中间会经历N多个环节-此处不需要了解-唯一需要注意的一个点-就在于SpringMVC的组件会调用DispatcherServlet的组件进行初始化工作-这些初始化工作会完成对于九大组件的初始化-这个初始化会从DispatcherServlet.properties文件中进行相应的属性值加载。</p><p>HttpServletBean———init()</p><p>\`\`<code>java
public final void init() throws ServletException {		// Set bean properties from init parameters.    	// 将web.xml文件中初始化参数设置到bean中-requiredProperties为必须参数		PropertyValues pvs = new ServletConfigPropertyValues(getServletConfig(), this.requiredProperties);		if (!pvs.isEmpty()) {			try {                //将DispatcherServlet类添加到BeanWrapper的包装类中				BeanWrapper bw = PropertyAccessorFactory.forBeanPropertyAccess(this);				ResourceLoader resourceLoader = new ServletContextResourceLoader(getServletContext());				bw.registerCustomEditor(Resource.class, new ResourceEditor(resourceLoader, getEnvironment()));                //对DispatcherServlet进行初始化工作				initBeanWrapper(bw);                //将配置的初始化值设置到DispatcherServlet中				bw.setPropertyValues(pvs, true);			}			catch (BeansException ex) {				if (logger.isErrorEnabled()) {					logger.error("Failed to set bean properties on servlet '" + getServletName() + "'", ex);				}				throw ex;			}		}		// Let subclasses do whatever initialization they like.    	// 模板方法-子类初始化的入口方法		initServletBean();	}
</code>\`<code></p><p>调用子类方法实现初始化BeanServlet</p><p>FrameworlServlet——initServletBean</p><p></code>\`<code>java
protected final void initServletBean() throws ServletException {		getServletContext().log("Initializing Spring " + getClass().getSimpleName() + " '" + getServletName() + "'");		if (logger.isInfoEnabled()) {			logger.info("Initializing Servlet '" + getServletName() + "'");		}    	// 设置开始时间		long startTime = System.currentTimeMillis();		try {            // webApplicationContext是FrameworkServlet的上下文-后续的方法是进行上下万的初始化			this.webApplicationContext = initWebApplicationContext();            // 初始化FrameworkServlet-默认实现为null-由子类进行实现			initFrameworkServlet();		}		catch (ServletException | RuntimeException ex) {			logger.error("Context initialization failed", ex);			throw ex;		}		if (logger.isDebugEnabled()) {			String value = this.enableLoggingRequestDetails ?					"shown which may lead to unsafe logging of potentially sensitive data" :					"masked to prevent unsafe logging of potentially sensitive data";			logger.debug("enableLoggingRequestDetails='" + this.enableLoggingRequestDetails +					"': request parameters and headers will be " + value);		}		if (logger.isInfoEnabled()) {			logger.info("Completed initialization in " + (System.currentTimeMillis() - startTime) + " ms");		}	}
</code>\`<code></p><p>此后的流程会进入到Spring的onRefresh方法中-最终会调用DispatcherServlet中的onRefresh方法。</p><p></code>\`<code>java
@Override	protected void onRefresh(ApplicationContext context) {		initStrategies(context);	}	/**	 * Initialize the strategy objects that this servlet uses.	 *
</code>\`<code></p><p>​ 这几个组件的初始化过程都差不多-因此我们选择一个来重点描述-其他的需要大家下去之后自己来研究了。</p><p></code>\`<code>java
private void initHandlerMappings(ApplicationContext context) {		this.handlerMappings = null;		// 是否查找所有HandlerMapping标识		if (this.detectAllHandlerMappings) {			// Find all HandlerMappings in the ApplicationContext, including ancestor contexts.            // 从上下文中查找HandlerMapping类型的Bean			Map matchingBeans =					BeanFactoryUtils.beansOfTypeIncludingAncestors(context, HandlerMapping.class, true, false);			if (!matchingBeans.isEmpty()) {				this.handlerMappings = new ArrayList<>(matchingBeans.values());				// We keep HandlerMappings in sorted order.				AnnotationAwareOrderComparator.sort(this.handlerMappings);			}		}		else {			try {                // 根据指定名称获取HandlerMapping对象				HandlerMapping hm = context.getBean(HANDLER_MAPPING_BEAN_NAME, HandlerMapping.class);				this.handlerMappings = Collections.singletonList(hm);			}			catch (NoSuchBeanDefinitionException ex) {				// Ignore, we'll add a default HandlerMapping later.			}		}		// Ensure we have at least one HandlerMapping, by registering		// a default HandlerMapping if no other mappings are found.    	// 确保至少有一个HandlerMapping-如果没有找到-使用默认策略-注册一个默认的		if (this.handlerMappings == null) {			this.handlerMappings = getDefaultStrategies(context, HandlerMapping.class);			if (logger.isTraceEnabled()) {				logger.trace("No HandlerMappings declared for servlet '" + getServletName() +					`,
    author: defaultAuthor,
    readTime: '70 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "Spring Boot Source Code Analysis",
    excerpt: "Understanding Spring Boot auto-configuration mechanism, starter dependencies, and application startup process internals.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-07-19-spring-boot',
    date: 'July 19, 2020',
    category: 'Backend',
    tags: ["Framework","Spring Boot","Source Code"],
    slug: '2020-07-19-spring-boot',
    content: `<p><h1>启动过程</h1></p><p><h3>1、springboot的入口程序</h3></p><p>\`\`<code>java
@SpringBootApplicationpublic class StartupApplication {    public static void main(String[] args) {        SpringApplication.run(StartupApplication.class, args);    }}
</code>\`<code></p><p>当程序开始执行之后-会调用SpringApplication的构造方法-进行某些初始参数的设置</p><p></code>\`<code>java
//创建一个新的实例-这个应用程序的上下文将要从指定的来源加载Beanpublic SpringApplication(ResourceLoader resourceLoader, Class... primarySources) {    //资源初始化资源加载器-默认为null	this.resourceLoader = resourceLoader;    //断言主要加载资源类不能为 null-否则报错	Assert.notNull(primarySources, "PrimarySources must not be null");    //初始化主要加载资源类集合并去重	this.primarySources = new LinkedHashSet<>(Arrays.asList(primarySources));    //推断当前 WEB 应用类型-一共有三种：NONE,SERVLET,REACTIVE	this.webApplicationType = WebApplicationType.deduceFromClasspath();    //设置应用上线文初始化器,从"META-INF/spring.factories"读取ApplicationContextInitializer类的实例名称集合并去重-并进行set去重。（一共7个）	setInitializers((Collection) getSpringFactoriesInstances(ApplicationContextInitializer.class));    //设置监听器,从"META-INF/spring.factories"读取ApplicationListener类的实例名称集合并去重-并进行set去重。（一共11个）	setListeners((Collection) getSpringFactoriesInstances(ApplicationListener.class));    //推断主入口应用类-通过当前调用栈-获取Main方法所在类-并赋值给mainApplicationClass	this.mainApplicationClass = deduceMainApplicationClass();	}
</code>\`<code></p><p>在上述构造方法中-有一个判断应用类型的方法-用来判断当前应用程序的类型：</p><p></code>\`<code>java
static WebApplicationType deduceFromClasspath() {		if (ClassUtils.isPresent(WEBFLUX_INDICATOR_CLASS, null) && !ClassUtils.isPresent(WEBMVC_INDICATOR_CLASS, null)				&& !ClassUtils.isPresent(JERSEY_INDICATOR_CLASS, null)) {			return WebApplicationType.REACTIVE;		}		for (String className : SERVLET_INDICATOR_CLASSES) {			if (!ClassUtils.isPresent(className, null)) {				return WebApplicationType.NONE;			}		}		return WebApplicationType.SERVLET;	}//WebApplicationType的类型public enum WebApplicationType {	/<strong>	 * The application should not run as a web application and should not start an	 * embedded web server.	 * 非web项目	 */	NONE,	/</strong>	 * The application should run as a servlet-based web application and should start an	 * embedded servlet web server.	 * servlet web 项目	 */	SERVLET,	/**	 * The application should run as a reactive web application and should start an	 * embedded reactive web server.	 * 响应式 web 项目	 */	REACTIVE;
</code>\`<code></p><p>springboot启动的运行方法-可以看到主要是各种运行环境的准备工作</p><p></code>\`<code>java
public ConfigurableApplicationContext run(String... args) {    //1、创建并启动计时监控类	StopWatch stopWatch = new StopWatch();	stopWatch.start();    //2、初始化应用上下文和异常报告集合	ConfigurableApplicationContext context = null;	Collection exceptionReporters = new ArrayList<>();    //3、设置系统属性“java.awt.headless”的值-默认为true-用于运行headless服务器-进行简单的图像处理-多用于在缺少显示屏、键盘或者鼠标时的系统配置-很多监控工具如jconsole 需要将该值设置为true	configureHeadlessProperty();    //4、创建所有spring运行监听器并发布应用启动事件-简单说的话就是获取SpringApplicationRunListener类型的实例（EventPublishingRunListener对象）-并封装进SpringApplicationRunListeners对象-然后返回这个SpringApplicationRunListeners对象。说的再简单点-getRunListeners就是准备好了运行时监听器EventPublishingRunListener。	SpringApplicationRunListeners listeners = getRunListeners(args);	listeners.starting();	try {        //5、初始化默认应用参数类		ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);        //6、根据运行监听器和应用参数来准备spring环境		ConfigurableEnvironment environment = prepareEnvironment(listeners, applicationArguments);        //将要忽略的bean的参数打开		configureIgnoreBeanInfo(environment);        //7、创建banner打印类		Banner printedBanner = printBanner(environment);        //8、创建应用上下文-可以理解为创建一个容器		context = createApplicationContext();        //9、准备异常报告器-用来支持报告关于启动的错误		exceptionReporters = getSpringFactoriesInstances(SpringBootExceptionReporter.class,					new Class[] { ConfigurableApplicationContext.class }, context);        //10、准备应用上下文-该步骤包含一个非常关键的操作-将启动类注入容器-为后续开启自动化提供基础		prepareContext(context, environment, listeners, applicationArguments, printedBanner);        //11、刷新应用上下文		refreshContext(context);        //12、应用上下文刷新后置处理-做一些扩展功能		afterRefresh(context, applicationArguments);        //13、停止计时监控类		stopWatch.stop();        //14、输出日志记录执行主类名、时间信息		if (this.logStartupInfo) {				new StartupInfoLogger(this.mainApplicationClass).logStarted(getApplicationLog(), stopWatch);		}        //15、发布应用上下文启动监听事件		listeners.started(context);        //16、执行所有的Runner运行器		callRunners(context, applicationArguments);	}catch (Throwable ex) {		handleRunFailure(context, ex, exceptionReporters, listeners);		throw new IllegalStateException(ex);	}	try {        //17、发布应用上下文就绪事件		listeners.running(context);	}catch (Throwable ex) {		handleRunFailure(context, ex, exceptionReporters, null);		throw new IllegalStateException(ex);	}    //18、返回应用上下文	return context;}
</code>\`<code></p><p>下面详细介绍各个启动的环节：</p><p>1、创建并启动计时监控类-可以看到记录当前任务的名称-默认是空字符串-然后记录当前springboot应用启动的开始时间。</p><p></code>\`<code>java
StopWatch stopWatch = new StopWatch();stopWatch.start();//详细源代码public void start() throws IllegalStateException {	start("");}public void start(String taskName) thr`,
    author: defaultAuthor,
    readTime: '153 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Advanced Spring MVC Usage",
    excerpt: "Advanced Spring MVC features including interceptors, exception handling, file upload, async processing, and RESTful best practices.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-07-20-spring-mvc-2',
    date: 'July 20, 2020',
    category: 'Spring',
    tags: ["Spring","Spring MVC"],
    slug: '2020-07-20-spring-mvc-2',
    content: `<p><h1>Spring MVC的使用-2</h1></p><p><h3>1、SpringMVC的返回JSON数据</h3></p><p>​ 到目前为止我们编写的所有Controller的方法的返回值都是String类型-但是大家应该都知道-我们有时候数据传递特别是在ajax中-我们返回的数据经常需要使用json-那么如何来保证返回的数据的是json格式呢？使用@ResponseBody注解</p><p>pom.xml</p><p>\`\`<code>xml
    4.0.0    com.oi    springmv_ajax    1.0-SNAPSHOT                                org.springframework            spring-context            5.2.3.RELEASE                                    org.springframework            spring-web            5.2.3.RELEASE                                    org.springframework            spring-webmvc            5.2.3.RELEASE                            javax.servlet            servlet-api            2.5            provided                            javax.servlet            jsp-api            2.0            provided                                    com.fasterxml.jackson.core            jackson-core            2.10.3                                    com.fasterxml.jackson.core            jackson-databind            2.10.3                                    com.fasterxml.jackson.core            jackson-annotations            2.10.3
</code>\`<code></p><p>springmvc.xml</p><p>JsonController.java</p><p></code>\`<code>java
package com.oi.controller;import com.oi.bean.User;import org.springframework.stereotype.Controller;import org.springframework.web.bind.annotation.RequestMapping;import org.springframework.web.bind.annotation.ResponseBody;import java.util.ArrayList;import java.util.Date;import java.util.List;@Controllerpublic class JsonController {    @ResponseBody    @RequestMapping("/json")    public List json(){        List list = new ArrayList();        list.add(new User(1,"zhangsan",12,"男",new Date(),"1234@qq.com"));        list.add(new User(2,"zhangsan2",12,"男",new Date(),"1234@qq.com"));        list.add(new User(3,"zhangsan3",12,"男",new Date(),"1234@qq.com"));        return list;    }}
</code>\`<code></p><p>User.java</p><p></code>\`<code>java
package com.oi.bean;import com.fasterxml.jackson.annotation.JsonFormat;import com.fasterxml.jackson.annotation.JsonIgnore;import java.util.Date;public class User {    private Integer id;    private String name;    private Integer age;    private String gender;    @JsonFormat( pattern = "yyyy-MM-dd")    private Date birth;    @JsonIgnore    private String email;    public User() {    }    public User(Integer id, String name, Integer age, String gender, Date birth, String email) {        this.id = id;        this.name = name;        this.age = age;        this.gender = gender;        this.birth = birth;        this.email = email;    }    public Integer getId() {        return id;    }    public void setId(Integer id) {        this.id = id;    }    public String getName() {        return name;    }    public void setName(String name) {        this.name = name;    }    public Integer getAge() {        return age;    }    public void setAge(Integer age) {        this.age = age;    }    public String getGender() {        return gender;    }    public void setGender(String gender) {        this.gender = gender;    }    public Date getBirth() {        return birth;    }    public void setBirth(Date birth) {        this.birth = birth;    }    public String getEmail() {        return email;    }    public void setEmail(String email) {        this.email = email;    }    @Override    public String toString() {        return "User{" +                "id=" + id +                ", name='" + name + '\'' +                ", age=" + age +                ", gender='" + gender + '\'' +                ", birth=" + birth +                ", email='" + email + '\'' +                '}';    }}
</code>\`<code></p><p>同时@ResponseBody可以直接将返回的字符串数据作为响应内容</p><p></code>\`<code>java
package com.oi.controller;import com.oi.bean.User;import org.springframework.http.HttpEntity;import org.springframework.stereotype.Controller;import org.springframework.web.bind.annotation.RequestBody;import org.springframework.web.bind.annotation.RequestMapping;import org.springframework.web.bind.annotation.ResponseBody;@Controllerpublic class OtherController {    @ResponseBody    @RequestMapping("/testResponseBody")    public String testResponseBody(){        return "success";    }}
</code>\`<code></p><p><h3>2、发送ajax请求获取json数据</h3></p><p>ajax.jsp</p><p></code>\`<code>
<%@ page import="java.util.Date" %><%@ page contentType="text/html;charset=UTF-8" language="java" %>    Title    <%    pageContext.setAttribute("ctp",request.getContextPath());%><%=new Date()%>获取用户信息    \$("a:first").click(function () {        \$.ajax({            url:"\${ctp}/json",            type:"GET",            success:function (data) {                console.log(data)                \$.each(data,function() {                    var user = this.id+"--"+this.name+"--"+this.age+"--"+this.gender+"--"+this.birth+"--"+this.email;                    \$("div").append(user+'<br/>');                })            }        });        return false;    });
</code>\`<code></p><p><h3>3、使用@RequestBody获取请求体信息</h3></p`,
    author: defaultAuthor,
    readTime: '79 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "Feign Principles and Usage",
    excerpt: "Declarative REST client with Feign covering integration with Spring Cloud, load balancing, circuit breakers, and error handling.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-07-23-feign',
    date: 'July 23, 2020',
    category: 'Backend',
    tags: ["Spring Cloud","Framework"],
    slug: '2020-07-23-feign',
    content: `<p><h2>Feign</h2></p><p>OpenFeign是Netflix 开发的声明式、模板化的HTTP请求客户端。可以更加便捷、优雅地调用http api。</p><p>OpenFeign会根据带有注解的函数信息构建出网络请求的模板-在发送网络请求之前-OpenFeign会将函数的参数值设置到这些请求模板中。</p><p>feign主要是构建微服务消费端。只要使用OpenFeign提供的注解修饰定义网络请求的接口类-就可以使用该接口的实例发送RESTful的网络请求。还可以集成Ribbon和Hystrix-提供负载均衡和断路器。</p><p>英文表意为“假装-伪装-变形”- 是一个 Http 请求调用的轻量级框架-可以以 Java 接口注解的方式调用 Http 请求-而不用像 Java 中通过封装 HTTP 请求报文的方式直接调用。通过处理注解-将请求模板化-当实际调用的时候-传入参数-根据参数再应用到请求上-进而转化成真正的请求-这种请求相对而言比较直观。Feign 封装 了HTTP 调用流程-面向接口编程-回想第一节课的SOP。</p><p><h3>Feign和OpenFeign的关系</h3></p><p>Feign本身不支持Spring MVC的注解-它有一套自己的注解</p><p>OpenFeign是Spring Cloud 在Feign的基础上支持了Spring MVC的注解-如@RequesMapping等等。  
OpenFeign的<code>@FeignClient</code>可以解析SpringMVC的@RequestMapping注解下的接口-  
并通过动态代理的方式产生实现类-实现类中做负载均衡并调用其他服务。</p><p><h2>声明式服务调用</h2></p><p>provider方提供公用API包-Feign通过SpringMVC的注解来加载URI</p><p><h3>1.创建项目User-Provider</h3></p><p><img src="/images/blog/image-20200413170210544.png" alt="illustration" class="my-4" /></p><p>#### <strong>选择依赖</strong></p><p><img src="/images/blog/image-20200413170342890.png" alt="illustration" class="my-4" /></p><p><h3>2.创建项目User-API</h3></p><p>依赖 spring-boot-starter-web</p><p>#### 创建一个接口 RegisterApi</p><p>\`\`<code>java
package com.mashibing.UserAPI;import org.springframework.web.bind.annotation.GetMapping;import org.springframework.web.bind.annotation.RequestMapping;/** * 用户操作相关接口 * @author 一明哥 * */@RequestMapping("/User")public interface RegisterApi {	@GetMapping("/isAlive")	public String isAlive();}
</code>\`<code></p><p><h3>3.User-Provider 实现API</h3></p><p>#### 配置文件</p><p></code>\`<code>properties
eureka.client.service-url.defaultZone=http://euk1.com:7001/eureka/server.port=81spring.application.name=user-provider
</code>\`<code></p><p>#### 引入API</p><p>1.maven install User-Api项目</p><p>2.User-Provider的Pom.xml添加依赖</p><p></code>\`<code>xml
		com.mashibing.User-API		User-API		0.0.1-SNAPSHOT
</code>\`<code></p><p>#### 创建UserController</p><p>实现Api的接口</p><p></code>\`<code>java
package com.mashibing.UserProvider;import com.mashibing.UserAPI.RegisterApi;@RestControllerpublic class UserController implements RegisterApi {	@Override	public String isAlive() {		// TODO Auto-generated method stub		return "ok";	}}
</code>\`<code></p><p><h3>4.Consumer调用</h3></p><p>#### 创建项目User-Consumer</p><p><img src="/images/blog/image-20200413171817399.png" alt="illustration" class="my-4" /></p><p>#### 依赖</p><p><img src="/images/blog/image-20200413171910314.png" alt="illustration" class="my-4" /></p><p>#### 引入API</p><p>Pom.xml添加依赖</p><p></code>\`<code>xml
		com.mashibing.User-API		User-API		0.0.1-SNAPSHOT
</code>\`<code></p><p>#### 配置文件</p><p></code>\`<code>properties
eureka.client.service-url.defaultZone=http://euk1.com:7001/eureka/server.port=90spring.application.name=consumer
</code>\`<code></p><p>#### 创建Service接口</p><p></code>\`<code>java
package com.mashibing.UserConsumer;import org.springframework.cloud.openfeign.FeignClient;import com.mashibing.UserAPI.RegisterApi;@FeignClient(name = "user-provider")public interface UserConsumerService extends RegisterApi {}
</code>\`<code></p><p>#### 创建Controller</p><p></code>\`<code>plain
package com.mashibing.UserConsumer;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.web.bind.annotation.GetMapping;import org.springframework.web.bind.annotation.RestController;@RestControllerpublic class ConsumerController {	@Autowired	UserConsumerService consumerSrv;		@GetMapping("/alive")	public String alive() {				return consumerSrv.isAlive();	}	}
</code>\`<code></p><p>#### 修改启动类</p><p></code>\`<code>plain
package com.mashibing.UserConsumer;import org.springframework.boot.SpringApplication;import org.springframework.boot.autoconfigure.SpringBootApplication;import org.springframework.cloud.openfeign.EnableFeignClients;@SpringBootApplication@EnableFeignClientspublic class UserConsumerApplication {	public static void main(String[] args) {		SpringApplication.run(UserConsumerApplication.class, args);	}}
</code>\`<code></p><p><h3>5.测试</h3></p><p>访问 <a href="http://localhost:90/alive">http://localhost:90/alive</a> 即可完成声明式远程服务调用</p><p><h2>Get和Post</h2></p><p>Feign默认所有带参数的请求都是Post-想要使用指定的提交方式需引入依赖</p><p></code>\`<code>plain
    io.github.openfeign    feign-httpclient
</code>\`<code></p><p>并指明提交方式</p><p></code>\`<code>plain
@RequestMapping(value = "/alived", method = RequestMethod.POST)@GetMapping("/findById")
</code>\`<code></p><p><h3>带参请求</h3></p><p></code>\`<code>plain
@GetMapping("/findById")public Map findById(@RequestParam("id") Integer id);@PostMapping("/register")public Map reg(@RequestBody User user);
</code>\`<code></p><p><h2>权限</h2></p><p>feign的默认配置类是：org.springframework.cloud.openfeign.FeignClientsConfiguration。默认定义了feign使用的编码器-解码器等。</p><p>允许使用@FeignClient的configuration的属性自定义Feign配置。自定义的配置优先级高于上面的FeignClientsConfiguration。</p><p>通过权限的例子-学习feign的自定义配置。</p><p>服务提供者。上述例子开放service-valuation的权限 后-访问。</p><p></code>\`<code>sh
开放权限：	org.springframework.boot	spring-boot-starter-security@Configuration@EnableWebSecuritypublic class WebSecurityConfig extends `,
    author: defaultAuthor,
    readTime: '19 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Distributed Lock Solutions",
    excerpt: "Implementing distributed locks using Redis and Zookeeper with comparison of different approaches and failure handling strategies.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-07-23',
    date: 'July 23, 2020',
    category: 'Distributed Systems',
    tags: ["Distributed","Summary","Distributed Lock"],
    slug: '2020-07-23',
    content: `<p><h1>分布式锁</h1></p><p>千万级流量以上的项目-基本上都会用redis。</p><p>RedLock-redis创始人 比较提出的方案。</p><p><h2>我们真的需要锁么？</h2></p><p>需要锁的条件：</p><p><li> 多任务环境下。（进程-线程）</li>
<li> 任务都对同一共享资源进行写操作。</li>
<li> 对资源的访问是互斥的。</li></p><p>操作周期：</p><p><li> 竞争锁。获取锁后才能对资源进行操作。</li>
<li> 占有锁。操作中。</li>
<li> 其他竞争者-任务阻塞。</li>
<li> 占有锁者-释放锁。继续从1开始。</li></p><p>JVM 锁 解决不了分布式环境中的加锁问题。</p><p>分布式锁应用场景：服务集群-比如N个订单服务-接受到大量司机的发送的对一个订单的抢单请求。如果是单个服务-可以用jvm锁控制-但是服务集群-jvm 就不行了。因为不在一个jvm中。</p><p><h2>分布式锁解决方案</h2></p><p>api-driver, eureka 7900 service-order 8004,8005</p><p><h2>无锁情况</h2></p><p>\`\`<code>sh
@Qualifier("grabNoLockService")tb_order表中 status设置0执行jmeter。司机抢单。结果：司机:1 执行抢单逻辑司机:2 执行抢单逻辑司机:1 抢单成功司机:3 执行抢单逻辑司机:2 抢单成功司机:4 执行抢单逻辑司机:3 抢单失败司机:5 执行抢单逻辑司机:4 抢单失败司机:6 执行抢单逻辑司机:5 抢单失败司机:7 执行抢单逻辑司机:6 抢单失败司机:8 执行抢单逻辑司机:7 抢单失败司机:8 抢单失败司机:9 执行抢单逻辑司机:10 执行抢单逻辑司机:9 抢单失败司机:10 抢单失败1和2 都抢单成功。
</code>\`<code></p><p><h2>JVM 锁</h2></p><p></code>\`<code>sh
@Qualifier("grabJvmLockService")司机:1 执行抢单逻辑2020-03-07 12:20:46.931  INFO 20484 --- [nio-8004-exec-1] com.alibaba.druid.pool.DruidDataSource   : {dataSource-9} inited司机:1 抢单成功司机:10 执行抢单逻辑司机:10 抢单失败司机:9 执行抢单逻辑司机:9 抢单失败司机:8 执行抢单逻辑司机:8 抢单失败司机:7 执行抢单逻辑司机:7 抢单失败司机:6 执行抢单逻辑司机:6 抢单失败司机:5 执行抢单逻辑司机:5 抢单失败司机:4 执行抢单逻辑司机:4 抢单失败司机:3 执行抢单逻辑司机:3 抢单失败司机:2 执行抢单逻辑司机:2 抢单失败只有一个抢单成功
</code>\`<code></p><p>但是：启动两个service-order8004,8005-则有下面情况</p><p></code>\`<code>sh
8005:司机:1 执行抢单逻辑2020-03-07 12:43:49.821  INFO 9292 --- [nio-8005-exec-1] com.alibaba.druid.pool.DruidDataSource   : {dataSource-1} inited司机:1 抢单成功司机:9 执行抢单逻辑司机:9 抢单失败司机:7 执行抢单逻辑司机:7 抢单失败司机:5 执行抢单逻辑司机:5 抢单失败司机:3 执行抢单逻辑司机:3 抢单失败8004:司机:2 执行抢单逻辑2020-03-07 12:43:49.977  INFO 8880 --- [nio-8004-exec-1] com.alibaba.druid.pool.DruidDataSource   : {dataSource-1} inited司机:2 抢单成功司机:10 执行抢单逻辑司机:10 抢单失败司机:8 执行抢单逻辑司机:8 抢单失败司机:6 执行抢单逻辑司机:6 抢单失败司机:4 执行抢单逻辑司机:4 抢单失败
</code>\`<code></p><p>问题：无法解决分布式-集群环境的问题。所以要用分布锁</p><p><h2>基于mysql</h2></p><p>测试时要恢复数据。tbl_order 中status 为0-tbl_order_lock清空</p><p>@Qualifier(“grabMysqlLockService”) 实际用 事件实现。</p><p></code>\`<code>sh
8005:司机6加锁成功司机:6 执行抢单逻辑司机:6 抢单成功司机4加锁成功司机:4 执行抢单逻辑司机:4 抢单失败司机8加锁成功司机:8 执行抢单逻辑司机:8 抢单失败司机10加锁成功司机:10 执行抢单逻辑司机:10 抢单失败司机2加锁成功司机:2 执行抢单逻辑司机:2 抢单失败8004:2020-03-07 12:50:04.938  INFO 7356 --- [nio-8004-exec-1] com.alibaba.druid.pool.DruidDataSource   : {dataSource-1} inited司机7加锁成功司机:7 执行抢单逻辑司机:7 抢单失败司机1加锁成功司机:1 执行抢单逻辑司机:1 抢单失败司机5加锁成功司机:5 执行抢单逻辑司机:5 抢单失败司机9加锁成功司机:9 执行抢单逻辑司机:9 抢单失败司机3加锁成功司机:3 执行抢单逻辑司机:3 抢单失败
</code>\`<code></p><p>问题：</p><p>1、如果中间出异常了-如何释放锁-用存储过程-还是可以解决。</p><p>2、mysql 并发是由限制的。不适合高并发场景。</p><p>压测结果：<a href="https://help.aliyun.com/document_detail/150351.html?spm=a2c4g.11186623.6.1463.1e732d02nCMBBa">https://help.aliyun.com/document_detail/150351.html?spm=a2c4g.11186623.6.1463.1e732d02nCMBBa</a></p><p>牛逼点的：<a href="https://help.aliyun.com/document_detail/101100.html?spm=5176.11065259.1996646101.searchclickresult.5a6316bcjenDJn">https://help.aliyun.com/document_detail/101100.html?spm=5176.11065259.1996646101.searchclickresult.5a6316bcjenDJn</a></p><p><h2>基于Redis</h2></p><p></code>\`<code>sh
stringRedisTemplate 用法https://blog.csdn.net/zzz127333092/article/details/88742088
</code>\`<code></p><p>redis：内存存储的数据结构服务器-内存数据库。可用于：数据库-高速缓存-消息队列。采用单线程模型-并发能力强大。10万并发没问题。</p><p>分布锁知识：</p><p>redis的单进程单线程。</p><p>缓存有效期。有效期到-删除数据。</p><p>setnx。当key存在-不做任何操作-key不存在-才设置。</p><p>> 《Redis 分布锁》</p><p>#### 单节点</p><p><strong>_加锁_</strong></p><p>SET orderId driverId NX PX 30000</p><p>上面的命令如果执行成功-则客户端成功获取到了锁-接下来就可以访问共享资源了；而如果上面的命令执行失败-则说明获取锁失败。</p><p><strong>_释放锁_</strong></p><p>关键-判断是不是自己加的锁。</p><p><strong>_关注点_</strong>：</p><p><li> orderId-是我们的key-要锁的目标。</li>
<li> driverId是由我们的司机ID-它要保证在足够长的一段时间内在所有客户端的所有获取锁的请求中都是唯一的。即一个订单被一个司机抢。</li>
<li> NX表示只有当orderId不存在的时候才能SET成功。这保证了只有第一个请求的客户端才能获得锁-而其它客户端在锁被释放之前都无法获得锁。</li>
<li> PX 30000表示这个锁有一个30秒的自动过期时间。当然-这里30秒只是一个例子-客户端可以选择合适的过期时间。</li>
<li> <strong>这个锁必须要设置一个过期时间。</strong>否则的话-当一个客户端获取锁成功之后-假如它崩溃了-或者由于发生了网络分区-导致它再也无法和Redis节点通信了-那么它就会一直持有这个锁-而其它客户端永远无法获得锁了。antirez在后面的分析中也特别强调了这一点-而且把这个过期时间称为锁的有效时间(lock validity time)。获得锁的客户端必须在这个时间之内完成对共享资源的访问。</li>
<li> 此操作不能分割。</li></p><p>    </code>\`<code>sh
    SETNX orderId driverIdEXPIRE orderId 30虽然这两个命令和前面算法描述中的一个SET命令执行效果相同-但却不是原子的。如果客户端在执行完SETNX后崩溃了-那么就没有机会执行EXPIRE了-导致它一直持有这个锁。造成死锁。
    </code>\`<code></p><p><li> 必须给key设置一个value。value保证每个线程不一样。如果value在每个线程间一样。会发生 误解锁的问题。</li></p><p>    </code>\`<code>sh
    1.客户端1获取锁成功。2.客户端1在某个操作上阻塞了很长时间。3.过期时间到了-锁自动释放了。4.客户端2获取到了对应同一个资源的锁。5.客户端1从阻塞中恢复过来-释放掉了客户端2持有的锁。之后-客户端2在访问共享资源的时候-就没有锁为它提供保护了。
    </code>\`<code></p><p><li> 释放锁的操作-得释放自己加的锁。</li></p><p></code>\`<code>sh
1.客户端1获取锁成功。2.客户端1访问共享资源。3.客户端1为了释放锁-先执行'GET'操作获取随机字符串的值。4.客户端1判断随机字符串的值-与预期的值相等。5.客户端1由于某个原因阻塞住了很长时间。6.过期时间到了-锁自动释放了。7.客户端2获取到了对应同一个资源的锁。8.客户端1从阻塞中恢复过来-执行DEL操纵-释放掉了客户端2持有的锁。
</code>\`<code></p><p><li> redis故障问题。</li></p><p>    如果redis故障了-所有客户端无法获取锁-服务变得不可用。为了提高可用性。我们给redis 配置主从。当master不可用时-系统切换到slave-由于Redis的主从复制（replication）是异步的-这可能导致丧失锁的安全性。</p><p>    </code>\`<code>sh
    1.客户端1从Master获取了锁。2.Master宕机了-存储锁的key还没有来得及同步到Slave上。3.Slave升级为Master。4.客户端2从新的Master获取到了对应同一个资源的锁。
    </code>\`<code><`,
    author: defaultAuthor,
    readTime: '18 min read',
    relatedPosts: ["2020-06-23-spring-cloud-eurekaactuator","2020-07-02"],
  },
  {
    title: "TCP/IP Protocol Illustrated",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-07-23-tcp-ip',
    date: 'July 23, 2020',
    category: 'Backend',
    tags: ["Notes","TCP-IP"],
    slug: '2020-07-23-tcp-ip',
    content: `<p>OSI七层参考模型</p><p><img src="/images/blog/Users\Anarchism\AppData\Roaming\Typora\typora-user-images\image-20200405195932930.png" alt="illustration" class="my-4" /> <img src="/images/blog/206633-2d6f4a3abcd59745.png" alt="illustration" class="my-4" /></p><p>HTTP协议</p><p><img src="/images/blog/Users\Anarchism\AppData\Roaming\Typora\typora-user-images\image-20200405200118533.png" alt="illustration" class="my-4" /></p><p><li> 应用层协议: HTTP协议, SSH协议</li></p><p>    应用层想建立通信, 先阻塞, 调内核, 告诉内核想和谁通信</p><p><li> 传输控制层, 如果是TCP协议, 制作一个握手的包, 制作之后阻塞, 调网络层</li>
<li> 网络层触发路由条目判定, 拿着目标的IP地址, 从路由表(有网络层就有路由表)去找, 从哪个口出去合适(找到哪个下一跳合适), 调链路</li>
<li> 链路层根据你要下一跳的IP地址, 通过ARP协议, 获取MAC地址, 有了映射之后, 封了一个数据包 {源端口号->目标端口号 源IP地址->目标IP地址 源MAC地址->目标MAC地址} 三层完成寻址</li></p><p><img src="/images/blog/image-20200406173649038.png" alt="illustration" class="my-4" /></p><p><li> arp广播, 可获得目标MAC地址</li>
<li> 每一跳MAC地址都会改变, 目标IP地址不变</li>
<li> 交换机衔接同一网络, 两层, 没有路由表</li>
<li> 路由器衔接不同网络, 三层, 有路由表, 可以做路由转发和判定</li></p><p><img src="/images/blog/image-20200406172106856.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406171335574.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406173740380.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406173811840.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406173837272.png" alt="illustration" class="my-4" /></p><p>高并发负载均衡:</p><p>tomcat为什么慢?  
是应用层, 要走很多层</p><p>LVS负载均衡服务器为什么快, 数据包级别, 没有七层, 要求后端服务器是镜像的  
LVS四层, Nginx七层</p><p>一层lvs hold住流量(流量负载层) 一层nginx hold住握手(接入层,接到后边tomcat)</p><p><img src="/images/blog/image-20200406174544842.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200406181203062.png" alt="illustration" class="my-4" /></p><p>负载均衡两块网卡, VIP虚拟网课, DIP分发网卡</p><p>方案一慢, D-NAT(基于三层,换ip): 保证去回的IP能对应 非对称 去的时候赛车,回来的时候变卡车 能力有限</p><p>方案二快, DR(基于二层,换mac): 直接路由模型 MAC欺骗 企业用得最多的</p><p><img src="/images/blog/image-20200406180132566.png" alt="illustration" class="my-4" /></p><p><li> 路由器有两个地址, 一个内网地址, 一个公网地址</li>
<li> 私有地址解决IP地址不够用问题, 不会出现在互联网上</li>
<li> S-NAT: (源地址)路由器修改1.8和1.6的端口号,</li>
<li> 上边图: VIP->RIP</li></p><p>公开课</p><p>1.和百度建立连接 : 应用层 走的是HTTP协议</p><p><img src="/images/blog/image-20200413201303047.png" alt="illustration" class="my-4" /></p><p>2.发送get请求 / 根目录,主页</p><p><img src="/images/blog/image-20200413201650607.png" alt="illustration" class="my-4" /></p><p>3.查看响应</p><p><img src="/images/blog/image-20200413202032204.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413202554457.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413202541641.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413203550480.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413205903398.png" alt="illustration" class="my-4" /></p><p><a href="https://blog.csdn.net/pashanhu6402/article/details/96428887">https://blog.csdn.net/pashanhu6402/article/details/96428887</a></p><p><img src="/images/blog/20190718154523875.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/20190718154556909.png" alt="illustration" class="my-4" /></p><p>服务器端先初始化Socket-然后与端口绑定(bind)-对端口进行监听(listen)-调用accept阻塞-等待客户端连接。在这时如果有个客户端初始化一个Socket-然后连接服务器(connect)-如果连接成功-这时客户端与服务器端的连接就建立了。客户端发送数据请求-服务器端接收请求并处理请求-然后把回应数据发送给客户端-客户端读取数据-最后关闭连接-一次交互结束。</p><p>共同开辟资源</p><p><img src="/images/blog/image-20200413204352374.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413204543971.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413210433311.png" alt="illustration" class="my-4" /></p><p>每个socket都能开65536个端口  
AC只占用一个端口  
一个</p><p>多层映射, 唯一路径</p><p><img src="/images/blog/image-20200413205547335.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413210039092.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413210411534.png" alt="illustration" class="my-4" /></p><p>抓包  
<img src="/images/blog/image-20200413210521953.png" alt="illustration" class="my-4" /></p><p>监听  
<img src="/images/blog/image-20200413210614147.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413210838852.png" alt="illustration" class="my-4" /></p><p>不可被分割的对小粒度: 三次握手->数据传输->四次挥手</p><p><img src="/images/blog/image-20200413211230556.png" alt="illustration" class="my-4" /></p><p>LVS四层 高并发负载均衡器 不能随便发包</p><p><img src="/images/blog/image-20200406174544842.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200413211648782.png" alt="illustration" class="my-4" /></p><p>三次握手, 传输控制层做第一个包, 阻塞住, 给网络层, 网络层给链路层</p><p><img src="/images/blog/image-20200413212157100.png" alt="illustration" class="my-4" /></p><p>IP地址:点分字节,0-255  
掩码: ip和11111100按位与,得到网络号192.168.150.0, 前三字段,  
网关: 链路层下一跳的地址  
DNS: 域名解析</p><p>路由表  
<img src="/images/blog/image-20200413212638496.png" alt="illustration" class="my`,
    author: defaultAuthor,
    readTime: '13 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Redis-Based Distributed Lock Implementation",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-07-23-redis',
    date: 'July 23, 2020',
    category: 'Redis',
    tags: ["Redis","Cache"],
    slug: '2020-07-23-redis',
    content: `<p><h2>概述</h2></p><p>为了防止分布式系统中的多个进程之间相互干扰-我们需要一种分布式协调技术来对这些进程进行调度。而这个分布式协调技术的核心就是来实现这个<strong>分布式锁</strong>。</p><p><h2>为什么要使用分布式锁</h2></p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-7cc8f57c65d81728.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/874/format/webp" alt="illustration" class="my-4" /></p><p><li>成员变量 A 存在 JVM1、JVM2、JVM3 三个 JVM 内存中</li>
<li>成员变量 A 同时都会在 JVM 分配一块内存-三个请求发过来同时对这个变量操作-显然结果是不对的</li>
<li>不是同时发过来-三个请求分别操作三个不同 JVM 内存区域的数据-变量 A 之间不存在共享-也不具有可见性-处理的结果也是不对的  </li>
  注：该成员变量 A 是一个有状态的对象</p><p>如果我们业务中确实存在这个场景的话-我们就需要一种方法解决这个问题-<strong>这就是分布式锁要解决的问题</strong></p><p><h2>分布式锁应该具备哪些条件</h2></p><p><li>在分布式系统环境下-一个方法在同一时间只能被一个机器的一个线程执行</li>
<li>高可用的获取锁与释放锁</li>
<li>高性能的获取锁与释放锁</li>
<li>具备可重入特性（可理解为重新进入-由多于一个任务并发使用-而不必担心数据错误）</li>
<li>具备锁失效机制-防止死锁</li>
<li>具备非阻塞锁特性-即没有获取到锁将直接返回获取锁失败</li></p><p><h2>分布式锁的实现有哪些</h2></p><p><li>Memcached：利用 Memcached 的 <code>add</code> 命令。此命令是原子性操作-只有在 <code>key</code> 不存在的情况下-才能 <code>add</code> 成功-也就意味着线程得到了锁。</li>
<li>Redis：和 Memcached 的方式类似-利用 Redis 的 <code>setnx</code> 命令。此命令同样是原子性操作-只有在 <code>key</code> 不存在的情况下-才能 <code>set</code> 成功。</li>
<li><strong>Zookeeper</strong>：利用 Zookeeper 的顺序临时节点-来实现分布式锁和等待队列。Zookeeper 设计的初衷-就是为了实现分布式锁服务的。</li>
<li>Chubby：Google 公司实现的粗粒度分布式锁服务-底层利用了 Paxos 一致性算法。</li></p><p><h2>通过 Redis 分布式锁的实现理解基本概念</h2></p><p>分布式锁实现的三个核心要素：</p><p><h3>加锁</h3></p><p>最简单的方法是使用 <code>setnx</code> 命令。<code>key</code> 是锁的唯一标识-按业务来决定命名。比如想要给一种商品的秒杀活动加锁-可以给 <code>key</code> 命名为 “lock_sale\_商品ID” 。而 <code>value</code> 设置成什么呢？我们可以姑且设置成 <code>1</code>。加锁的伪代码如下：</p><p>\`\`<code>plain
setnx（lock_sale_商品ID-1）
</code>\`<code></p><p>当一个线程执行 </code>setnx<code> 返回 </code>1<code>-说明 </code>key<code> 原本不存在-该线程成功得到了锁；当一个线程执行 </code>setnx<code> 返回 </code>0<code>-说明 </code>key<code> 已经存在-该线程抢锁失败。</p><p><h3>解锁</h3></p><p>有加锁就得有解锁。当得到锁的线程执行完任务-需要释放锁-以便其他线程可以进入。释放锁的最简单方式是执行 </code>del<code> 指令-伪代码如下：</p><p></code>\`<code>python
del（lock_sale_商品ID）
</code>\`<code></p><p>释放锁之后-其他线程就可以继续执行 </code>setnx<code> 命令来获得锁。</p><p><h3>锁超时</h3></p><p>锁超时是什么意思呢？如果一个得到锁的线程在执行任务的过程中挂掉-来不及显式地释放锁-这块资源将会永远被锁住（<strong>死锁</strong>）-别的线程再也别想进来。所以-</code>setnx<code> 的 </code>key<code> 必须设置一个超时时间-以保证即使没有被显式释放-这把锁也要在一定时间后自动释放。</code>setnx<code> 不支持超时参数-所以需要额外的指令-伪代码如下：</p><p></code>\`<code>plain
expire（lock_sale_商品ID- 30）
</code>\`<code></p><p>综合伪代码如下：</p><p></code>\`<code>csharp
if（setnx（lock_sale_商品ID-1） == 1）{    expire（lock_sale_商品ID-30）    try {        do something ......    } finally {        del（lock_sale_商品ID）    }}
</code>\`<code></p><p><h3>存在什么问题</h3></p><p>以上伪代码中存在三个致命问题</p><p>#### </code>setnx<code> 和 </code>expire<code> 的非原子性</p><p>设想一个极端场景-当某线程执行 </code>setnx<code>-成功得到了锁：</p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-153ca0fbc59af246.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/470/format/webp" alt="illustration" class="my-4" /></p><p></code>setnx<code> 刚执行成功-还未来得及执行 </code>expire<code> 指令-节点 1 挂掉了。</p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-616a3d3f9f42b60d.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/520/format/webp" alt="illustration" class="my-4" /></p><p>这样一来-这把锁就没有设置过期时间-变成<strong>死锁</strong>-别的线程再也无法获得锁了。</p><p>怎么解决呢？</code>setnx<code> 指令本身是不支持传入超时时间的-</code>set<code> 指令增加了可选参数-伪代码如下：</p><p></code>\`<code>bash
set（lock_sale_商品ID-1-30-NX）
</code>\`<code></p><p>这样就可以取代 </code>setnx<code> 指令。</p><p>#### </code>del<code> 导致误删</p><p>又是一个极端场景-假如某线程成功得到了锁-并且设置的超时时间是 30 秒。</p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-9c744a0adacf3591.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/470/format/webp" alt="illustration" class="my-4" /></p><p>如果某些原因导致线程 A 执行的很慢很慢-过了 30 秒都没执行完-这时候锁过期自动释放-线程 B 得到了锁。</p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-aff00874eea4ffb2.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/470/format/webp" alt="illustration" class="my-4" /></p><p>随后-线程 A 执行完了任务-线程 A 接着执行 </code>del<code> 指令来释放锁。但这时候线程 B 还没执行完-线程A实际上 </code>删除的是线程 B 加的锁<code>。</p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-d641463ea89da638.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/470/format/webp" alt="illustration" class="my-4" /></p><p>怎么避免这种情况呢？可以在 </code>del<code> 释放锁之前做一个判断-验证当前的锁是不是自己加的锁。至于具体的实现-可以在加锁的时候把当前的线程 ID 当做 </code>value<code>-并在删除之前验证 </code>key<code> 对应的 </code>value<code> 是不是自己线程的 ID。</p><p>加锁：</p><p></code>\`<code>dart
String threadId = Thread.currentThread().getId()set（key-threadId -30-NX）
</code>\`<code></p><p>解锁：</p><p></code>\`<code>csharp
if（threadId .equals(redisClient.get(key))）{    del(key)}
</code>\`<code></p><p>但是-这样做又隐含了一个新的问题-判断和释放锁是两个独立操作-不是原子性。</p><p>#### 出现并发的可能性</p><p>还是刚才第二点所描述的场景-虽然我们避免了线程 A 误删掉 </code>key<code> 的情况-但是同一时间有 A-B 两个线程在访问代码块-仍然是不完美的。怎么办呢？我们可以让获得锁的线程开启一个<strong>守护线程</strong>-用来给快要过期的锁“续航”。</p><p><img src="https:////upload-images.jianshu.io/upload_images/7986413-e6e284f3c6a07a85.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/470/format/webp" alt="illustration" class="my-4" /></p><p>当过去了 29 秒-线程`,
    author: defaultAuthor,
    readTime: '11 min read',
    relatedPosts: ["2020-06-15-redis"],
  },
  {
    title: "TCP/IP Protocol Deep Dive",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-07-23-tcp-ip',
    date: 'July 23, 2020',
    category: 'Backend',
    tags: ["TCP-IP","Network"],
    slug: '2020-07-23-tcp-ip',
    content: `<p><h2>脑图</h2></p><p><li> TCP 基本认识</li></p><p><img src="</images/blog/640(1" alt="illustration" class="my-4" />>)</p><p><li> TCP 连接建立</li></p><p><img src="</images/blog/640(2" alt="illustration" class="my-4" />>)</p><p><li> TCP 连接断开</li></p><p><img src="</images/blog/640(3" alt="illustration" class="my-4" />>)</p><p><li> Socket 编程</li></p><p><img src="</images/blog/640(4" alt="illustration" class="my-4" />>)</p><p>---</p><p><h2>正文</h2></p><p><h3>01 TCP 基本认识</h3></p><p>> 瞧瞧 TCP 头格式</p><p>我们先来看看 TCP 头的格式-标注颜色的表示与本文关联比较大的字段-其他字段不做详细阐述。</p><p><img src="</images/blog/640(5" alt="illustration" class="my-4" />>)TCP 头格式</p><p><strong>序列号</strong>：在建立连接时由计算机生成的随机数作为其初始值-通过 SYN 包传给接收端主机-每发送一次数据-就「累加」一次该「数据字节数」的大小。<strong>用来解决网络包乱序问题。</strong></p><p><strong>确认应答号</strong>：指下一次「期望」收到的数据的序列号-发送端收到这个确认应答以后可以认为在这个序号以前的数据都已经被正常接收。<strong>用来解决不丢包的问题。</strong></p><p><strong>控制位：</strong></p><p><li>_ACK_：该位为 <code>1</code> 时-「确认应答」的字段变为有效-TCP 规定除了最初建立连接时的 <code>SYN</code> 包之外该位必须设置为 <code>1</code> 。</li>
<li>_RST_：该位为 <code>1</code> 时-表示 TCP 连接中出现异常必须强制断开连接。</li>
<li>_SYC_：该位为 <code>1</code> 时-表示希望建立连-并在其「序列号」的字段进行序列号初始值的设定。</li>
<li>_FIN_：该位为 <code>1</code> 时-表示今后不会再有数据发送-希望断开连接。当通信结束希望断开连接时-通信双方的主机之间就可以相互交换 <code>FIN</code> 位置为 1 的 TCP 段。</li></p><p>> 为什么需要 TCP 协议？TCP 工作在哪一层？</p><p><code>IP</code> 层是「不可靠」的-它不保证网络包的交付、不保证网络包的按序交付、也不保证网络包中的数据的完整性。</p><p><img src="</images/blog/640(6" alt="illustration" class="my-4" />>)OSI 参考模型与 TCP/IP 的关系</p><p>如果需要保障网络数据包的可靠性-那么就需要由上层（传输层）的 <code>TCP</code> 协议来负责。</p><p>因为 TCP 是一个工作在<strong>传输层</strong>的<strong>可靠</strong>数据传输的服务-它能确保接收端接收的网络包是<strong>无损坏、无间隔、非冗余和按序的。</strong></p><p>> 什么是 TCP ？</p><p>TCP 是<strong>面向连接的、可靠的、基于字节流</strong>的传输层通信协议。</p><p><img src="</images/blog/640(7" alt="illustration" class="my-4" />>)</p><p><li><strong>面向连接</strong>：一定是「一对一」才能连接-不能像 UDP 协议 可以一个主机同时向多个主机发送消息-也就是一对多是无法做到的；</li>
<li><strong>可靠的</strong>：无论的网络链路中出现了怎样的链路变化-TCP 都可以保证一个报文一定能够到达接收端；</li>
<li><strong>字节流</strong>：消息是「没有边界」的-所以无论我们消息有多大都可以进行传输。并且消息是「有序的」-当「前一个」消息没有收到的时候-即使它先收到了后面的字节已经收到-那么也不能扔给应用层去处理-同时对「重复」的报文会自动丢弃。</li></p><p>> 什么是 TCP 连接？</p><p>我们来看看 RFC 793 是如何定义「连接」的：</p><p>_Connections:_</p><p>_The reliability and flow control mechanisms described above require that TCPs initialize and maintain certain status information for each data stream._</p><p>_The combination of this information, including sockets, sequence numbers, and window sizes, is called a connection._</p><p>简单来说就是-<strong>用于保证可靠性和流量控制维护的某些状态信息-这些信息的组合-包括Socket、序列号和窗口大小称为连接。</strong></p><p><img src="</images/blog/640(8" alt="illustration" class="my-4" />>)</p><p>所以我们可以知道-建立一个 TCP 连接是需要客户端与服务器端达成上述三个信息的共识。</p><p><li><strong>Socket</strong>：由 IP 地址和端口号组成</li>
<li><strong>序列号</strong>：用来解决乱序问题等</li>
<li><strong>窗口大小</strong>：用来做流量控制</li></p><p>> 如何唯一确定一个 TCP 连接呢？</p><p>TCP 四元组可以唯一的确定一个连接-四元组包括如下：</p><p><img src="</images/blog/640(9" alt="illustration" class="my-4" />>)</p><p><li>源地址</li>
<li>源端口</li>
<li>目的地址</li>
<li>目的端口</li></p><p><img src="/images/blog/gif;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==" alt="illustration" class="my-4" />TCP 四元组</p><p>源地址和目的地址的字段（32位）是在 IP 头部中-作用是通过 IP 协议发送报文给对方主机。</p><p>源端口和目的端口的字段（16位）是在 TCP 头部中-作用是告诉 TCP 协议应该把报文发给哪个进程。</p><p>> 有一个 IP 的服务器监听了一个端口-它的 TCP 的最大连接数是多少？</p><p>服务器通常固定在某个本地端口上监听-等待客户端的连接请求。</p><p>因此-客户端 IP 和 端口是可变的-其理论值计算公式如下:</p><p><img src="/images/blog/image-20200603233609203.png" alt="illustration" class="my-4" /></p><p>对 IPv4-客户端的 IP 数最多为 <code>2</code> 的 <code>32</code> 次方-客户端的端口数最多为 <code>2</code> 的 <code>16</code> 次方-也就是服务端单机最大 TCP 连接数-约为 <code>2</code> 的 <code>48</code> 次方。</p><p>当然-服务端最大并发 TCP 连接数远不能达到理论上限。</p><p><li>首先主要是<strong>文件描述符限制</strong>-Socket 都是文件-所以首先要通过 <code>ulimit</code> 配置文件描述符的数目；</li>
<li>另一个是<strong>内存限制</strong>-每个 TCP 连接都要占用一定内存-操作系统是有限的。</li></p><p>> UDP 和 TCP 有什么区别呢？分别的应用场景是？</p><p>UDP 不提供复杂的控制机制-利用 IP 提供面向「无连接」的通信服务。</p><p>UDP 协议真的非常简-头部只有 <code>8</code> 个字节（ 64 位）-UDP 的头部格式如下：</p><p><img src="</images/blog/640(11" alt="illustration" class="my-4" />>)UDP 头部格式</p><p><li>目标和源端口：主要是告诉 UDP 协议应该把报文发给哪个进程。</li>
<li>包长度：该字段保存了 UDP 首部的长度跟数据的长度之和。</li>
<li>校验和：校验和是为了提供可靠的 UDP 首部和数据而设计。</li></p><p><strong>TCP 和 UDP 区别：</strong></p><p>_1\. 连接_</p><p><li>TCP 是面向连接的传输层协议-传输数据前先要建立连接。</li>
<li>UDP 是不需要连接-即刻传输数据。</li></p><p>_2\. 服务对象_</p><p><li>TCP 是一对一的两点服务-即一条连接只有两个端点。</li>
<li>UDP 支持一对一、一对多、多对多的交互通信</li></p><p>_3\. 可靠性_</p><p><li>TCP 是可靠交付数据的-数据可以无差错、不丢失、不重复、按需到达。</li>
<li>UDP 是尽最大努力交付-不保证可靠交付数据。</li></p><p>_4\. 拥塞控制、流量控制_</p><p><li>TCP 有拥塞控制和流量控制机制-保证数据传输的安全性。</li>
<li>UDP 则没有-即使网络非常拥堵了-也不会影响 UDP 的发送速率。</li></p><p>_5\. 首部开销_</p><p><li>TCP 首部长度较长-会有一定的开销-首部在没有使用「选项」字段时是 <code>20</code> 个字节-如果使用了「选项」字段则会变长的。</li>
<li>UDP 首部只有 8 个字节-并且是固定不变的-开销较小。</li></p><p><strong>TCP 和 UDP 应用场景：</strong></p><p>由于 TCP 是面向连接-能保证数据的可靠性交付-因此经常用于：</p><p><li><code>FTP</code> 文件传输</li>
<li><code>HTTP</code> / <code>HTTPS</code></li></p><p>由于 UDP 面向无连接-它可以随时发送数据-再加上UDP本身的处理既简单又高效-因此经常用于：</p><p><li>包总量较少的通信-如 <code>DNS</code> 、<code`,
    author: defaultAuthor,
    readTime: '45 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Spring MVC Handler Adapter Source Code Analysis",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-07-24-spring-mvc',
    date: 'July 24, 2020',
    category: 'Spring',
    tags: ["Spring","Spring MVC"],
    slug: '2020-07-24-spring-mvc',
    content: `<p><h1>处理器适配器的详细处理过程</h1></p><p>​ 当把需要的处理器和适配器找到之后-下面就开始执行具体的处理过程了-通过下述代码进行调用：</p><p>\`\`<code>plain
mv = ha.handle(processedRequest, response, mappedHandler.getHandler());
</code>\`<code></p><p>找到RequestMappingHandlerAdapter的类中</p><p></code>\`<code>java
@Override	protected ModelAndView handleInternal(HttpServletRequest request,			HttpServletResponse response, HandlerMethod handlerMethod) throws Exception {		// 先声明ModelAndView结果		ModelAndView mav;        // 检查请求是否支持-1、通过supportedMethods方法判断是否包含请求方法-2、检查请求中是否包含session		checkRequest(request);		// Execute invokeHandlerMethod in synchronized block if required.        // 处理时是否对session加锁-默认为false		if (this.synchronizeOnSession) {            // 获取session对象			HttpSession session = request.getSession(false);            // 对session是否为空做判断-如果不等于空			if (session != null) {                // 获取session中锁对象				Object mutex = WebUtils.getSessionMutex(session);                // 加锁后执行调用处理器方法逻辑				synchronized (mutex) {					mav = invokeHandlerMethod(request, response, handlerMethod);				}			}			else {				// No HttpSession available -> no mutex necessary                // 没有session-则忽略加所-直接执行调用处理器方法逻辑				mav = invokeHandlerMethod(request, response, handlerMethod);			}		}		else {			// No synchronization on session demanded at all...			mav = invokeHandlerMethod(request, response, handlerMethod);		}		// 如果响应结果不包含缓存控制头		if (!response.containsHeader(HEADER_CACHE_CONTROL)) {            // 如果该处理器方法包含sessionAttribute			if (getSessionAttributesHandler(handlerMethod).hasSessionAttributes()) {				// 应哟个sessionAttributes的缓存策略                applyCacheSeconds(response, this.cacheSecondsForSessionAttributeHandlers);			}			else {                //不包含SessionAttribute-准备请求。内部逻辑应用配置的缓存策略-本适配器默认没有缓存策略-故所有请求都不返回缓存响应头				prepareResponse(response);			}		}		// 返回结果		return mav;	}
</code>\`<code></p><p><h3>1、mav = invokeHandlerMethod(request, response, handlerMethod);</h3></p><p></code>\`<code>java
@Nullable	protected ModelAndView invokeHandlerMethod(HttpServletRequest request,			HttpServletResponse response, HandlerMethod handlerMethod) throws Exception {		// 把请求和响应封装为一个ServletWebRequest对象		ServletWebRequest webRequest = new ServletWebRequest(request, response);		try {            // 创建WebDataBinderFactory工厂-该工厂用于获取处理器方法对应的WebDataBinder组件			WebDataBinderFactory binderFactory = getDataBinderFactory(handlerMethod);            // 获取当前处理器方法对应的Model工厂-该工厂用于获取处理器方法对应的model			ModelFactory modelFactory = getModelFactory(handlerMethod, binderFactory);			// 创建一个Servlet下可调用处理器的方法-内部创建了一个ServletInvocableHandlerMethod对象			ServletInvocableHandlerMethod invocableMethod = createInvocableHandlerMethod(handlerMethod);            //设置参数解析器			if (this.argumentResolvers != null) {				invocableMethod.setHandlerMethodArgumentResolvers(this.argumentResolvers);			}            // 设置返回值处理器			if (this.returnValueHandlers != null) {				invocableMethod.setHandlerMethodReturnValueHandlers(this.returnValueHandlers);			}            // 设置DataBinder工厂			invocableMethod.setDataBinderFactory(binderFactory);            // 设置参数名获取器-用于获取方法上的参数名			invocableMethod.setParameterNameDiscoverer(this.parameterNameDiscoverer);			// 创建用于处理过程中使用的ModelAndView容器			ModelAndViewContainer mavContainer = new ModelAndViewContainer();            // 向MV容器中添加FlashMap的属性			mavContainer.addAllAttributes(RequestContextUtils.getInputFlashMap(request));            // 初始化Model-包含调用Model相关的初始化方法-如ModelAttribute注解标记的方法			modelFactory.initModel(webRequest, mavContainer, invocableMethod);			//在重定向时忽略默认的Model属性值-只考虑重定向Model的属性值-默认为true	         mavContainer.setIgnoreDefaultModelOnRedirect(this.ignoreDefaultModelOnRedirect);			// 准备异步相关的处理			AsyncWebRequest asyncWebRequest = WebAsyncUtils.createAsyncWebRequest(request, response);			asyncWebRequest.setTimeout(this.asyncRequestTimeout);			WebAsyncManager asyncManager = WebAsyncUtils.getAsyncManager(request);			asyncManager.setTaskExecutor(this.taskExecutor);			asyncManager.setAsyncWebRequest(asyncWebRequest);			asyncManager.registerCallableInterceptors(this.callableInterceptors);			asyncManager.registerDeferredResultInterceptors(this.deferredResultInterceptors);			if (asyncManager.hasConcurrentResult()) {				Object result = asyncManager.getConcurrentResult();				mavContainer = (ModelAndViewContainer) asyncManager.getConcurrentResultContext()[0];				asyncManager.clearConcurrentResult();				LogFormatUtils.traceDebug(logger, traceOn -> {					String formatted = LogFormatUtils.formatValue(result, !traceOn);					return "Resume with async result [" + formatted + "]";				});				invocableMethod = invocableMethod.wrapConcurrentResult(result);			}			// 调用处理器方法并处理返回值			invocableMethod.invokeAndHandle(webRequest, mavContainer);			if (asyncManager.isConcurrentHandlingStarted()) {				return null;			}			// 获取MV结果			return getModelAndView(mavContainer, modelFactory, webRequest);		}		finally {            // 标记请求完成			webRequest.requestCompleted();		}	}
</code>\`<code></p><p>##### 1、WebDataBinderFactory binderFactory = getDataBinderFactory(handlerMe`,
    author: defaultAuthor,
    readTime: '48 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "LeetCode: Valid Parentheses Solution",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-07-25-leetcode',
    date: 'July 25, 2020',
    category: 'Backend',
    tags: ["Algorithm"],
    slug: '2020-07-25-leetcode',
    content: `<p>#### 括号配对</p><p>括号有效配对是指：  
1）任何一个左括号都能找到和其正确配对的右括号  
2）任何一个右括号都能找到和其正确配对的左括号  
有效的： (()) ()() (()()) 等  
无效的： (() )( 等</p><p>##### 问题1: 怎么判断一个括号字符串有效？</p><p>思路:</p><p><li> 用栈: 麻烦</li>
<li> 用单一变量, 遇到左括号count++, 遇到右括号count–, count<0,返回false, 最后count==0, 返回true</li></p><p>\`\`<code>java
public static boolean valid(String s) {    char[] str = s.tocharArray();    int count = 0;    for(int i = 0; i < str.length; i++) {        // 注意字符用单引号'('        count += str[i] == '(' ? 1 : -1;        if (count < 0) return false;    }    return count == 0;}
</code>\`<code></p><p>##### 问题2: 如果一个括号字符串无效-返回至少填几个字符能让其整体有效 (LeetCode 921)</p><p>思路:</p><p><li> 遇到左括号, count++, 遇到右括号, count–</li>
<li> 如果count == -1, need++, count恢复成0</li>
<li> 返回count + need</li></p><p></code>\`<code>java
public static int needParenthese (String s) {    char[] str = s.toCharArray();    int count = 0;    int need = 0;    for(int i = 0; i < str.length; i++) {        if(str[i] == '(') {            count++;        } else { // 遇到')'            if (count == 0) {                need++;            } else {                count--;            }        }    }    return count + need; }    public int minAddToMakeValid(String S) {        int L = 0;        int R = 0;        for (int i = 0; i
</code>\`<code></p><p>##### 问题3: 返回一个括号字符串中-最长的括号有效子串的长度 (动态规划) (LeetCode 32)</p><p>思路:</p><p><li> i位置是左括号, dp\[i\] = 0</li>
<li> i位置是右括号, dp\[i\] = dp\[i - 1\] + 2 + (pre > 0 ? dp\[pre -1\] : 0);</li>
<li> i位置往前推dp\[i-1\]个数, 的前一个数</li></p><p>    <img src="/images/blog/image-20200624125914653.png" alt="illustration" class="my-4" /></p><p></code>\`<code>java
public static int maxLength(String s) {	if(s == null || s.length() < 2) {		return 0;	}    char[] str = s.toCharArray();    int[] dp = new int[str.length];    int pre = 0;    int res = 0;    // 默认dp[0] = 0    for (int i = 1; i < str.length; i++) {        // 左括号不管        if(str[i] == ')') {            // 与str[i] 配对的左括号位置pre            pre = i - dp[i - 1] -1;            // pre是有效的, 并且是左括号            if (pre >= 0 && str[pre] == '(') {                // dp[i] = 前一个有效值 + 2 + 再前一个有效值(pre - 1要有效)                dp[i] = dp[i - 1] + 2 + (pre > 0 ? dp[pre -1] : 0);            }        }        res = Math.max(res, dp[i]);    }    return res;}
</code>\`<code></p><p>##### 问题4: 给定括号字符串, 返回该字符串最大嵌套层数</p><p>思路: 遇到左括号count++, 遇到右括号count–, 返回count最大值</p><p></code>\`<code>java
public static boolean isValid(String s) {    if(s == null || s.length == 0) {        return false;    }    char[] str = s.toCharArray();    // 辅助变量    int status = 0;    for (int i = 0; i < str.length; i++) {        if (str[i] != ')' && str[i] != '(') {            return false;        }        if (str[i] == ')' && --status < 0) {            return false;        }        if (str[i] == '(') {            status++;        }    }    return status == 0;}public static int deep(String s) {	if(!isValid(s)) return 0;    char[] str = s.toCharArray();    int count = 0;    int max = 0;    for (int i = 0; i < str.length; i++) {        if (str[i] == '(') {            max = Math.max(max, ++count);        } else {            count--;        }    }    return max;}
</code>\`\`</p>`,
    author: defaultAuthor,
    readTime: '8 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "RestTemplate and Ribbon: Principles and Usage",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-07-26-resttemplateribbon',
    date: 'July 26, 2020',
    category: 'Backend',
    tags: ["Spring Cloud","Framework","Notes"],
    slug: '2020-07-26-resttemplateribbon',
    content: `<p><h2>RestTemplate</h2></p><p><h3>依赖注入</h3></p><p>\`\`<code>plain
@Bean// 开启负载均衡@LoadBalancedRestTemplate restTemplate() {	return new RestTemplate();}
</code>\`<code></p><p>接下来便可以使用资源地址调用服务</p><p></code>\`<code>plain
String url ="http://provider/getHi";String respStr = restTemplate.getForObject(url, String.class);
</code>\`<code></p><p><h3>get 请求处理</h3></p><p>#### getForEntity</p><p>getForEntity方法的返回值是一个ResponseEntity-ResponseEntity是Spring对HTTP请求响应的封装-包括了几个重要的元素-如响应码、contentType、contentLength、响应消息体等。</p><p></code>\`<code>plain
<200,Hi,[Content-Type:"text/plain;charset=UTF-8", Content-Length:"8", Date:"Fri, 10 Apr 2020 09:58:44 GMT", Keep-Alive:"timeout=60", Connection:"keep-alive"]>
</code>\`<code></p><p>#### 返回一个Map</p><p><strong>调用方</strong></p><p></code>\`<code>plain
String url ="http://provider/getMap";   ResponseEntity entity = restTemplate.getForEntity(url, Map.class);   System.out.println("respStr: "  + entity.getBody() );
</code>\`<code></p><p><strong>生产方</strong></p><p></code>\`<code>plain
@GetMapping("/getMap")public Map getMap() {		HashMap map = new HashMap<>();	map.put("name", "500");	return map; }
</code>\`<code></p><p>#### 返回对象</p><p><strong>调用方</strong></p><p></code>\`<code>plain
ResponseEntity entity = restTemplate.getForEntity(url, Person.class);   System.out.println("respStr: "  + ToStringBuilder.reflectionToString(entity.getBody() ));
</code>\`<code></p><p><strong>生产方</strong></p><p></code>\`<code>plain
@GetMapping("/getObj")public Person getObj() {	Person person = new Person();	person.setId(100);	person.setName("xiaoming");	return person; }
</code>\`<code></p><p><strong>Person类</strong></p><p></code>\`<code>plain
private int id;private String name;
</code>\`<code></p><p>#### 传参调用</p><p><strong>使用占位符</strong></p><p></code>\`<code>
String url ="http://provider/getObjParam?name={1}";</p><p>ResponseEntity<Person> entity = restTemplate.getForEntity(url, Person.class,"hehehe...");
</code>\`<code></p><p><strong>使用map</strong></p><p></code>\`<code>plain
String url ="http://provider/getObjParam?name={name}";   Map map = Collections.singletonMap("name", " memeda");ResponseEntity entity = restTemplate.getForEntity(url, Person.class,map);
</code>\`<code></p><p>#### 返回对象</p><p></code>\`<code>plain
Person person = restTemplate.getForObject(url, Person.class,map);
</code>\`<code></p><p><h3>post 请求处理</h3></p><p><strong>调用方</strong></p><p></code>\`<code>plain
String url ="http://provider/postParam";   Map map = Collections.singletonMap("name", " memeda"); ResponseEntity entity = restTemplate.postForEntity(url, map, Person.class);
</code>\`<code></p><p><strong>生产方</strong></p><p></code>\`<code>plain
@PostMapping("/postParam")public Person postParam(@RequestBody String name) {	System.out.println("name:" + name);	Person person = new Person();	person.setId(100);	person.setName("xiaoming" + name);	return person; }
</code>\`<code></p><p><h3>postForLocation</h3></p><p><strong>调用方</strong></p><p></code>\`<code>plain
String url ="http://provider/postParam";   Map map = Collections.singletonMap("name", " memeda");URI location = restTemplate.postForLocation(url, map, Person.class);System.out.println(location);
</code>\`<code></p><p><strong>生产方</strong></p><p>需要设置头信息-不然返回的是null</p><p></code>\`<code>plain
public URI postParam(@RequestBody Person person,HttpServletResponse response) throws Exception {URI uri = new URI("https://www.baidu.com/s?wd="+person.getName());response.addHeader("Location", uri.toString());
</code>\`<code></p><p><h3>exchange</h3></p><p>可以自定义http请求的头信息-同时保护get和post方法</p><p><h3>拦截器</h3></p><p>需要实现</code>ClientHttpRequestInterceptor<code>接口</p><p><strong>拦截器</strong></p><p></code>\`<code>plain
public class LoggingClientHttpRequestInterceptor implements ClientHttpRequestInterceptor {	@Override	public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution)			throws IOException {		System.out.println("拦截啦！！！");		System.out.println(request.getURI());		ClientHttpResponse response = execution.execute(request, body);		System.out.println(response.getHeaders());		return response;	}
</code>\`<code></p><p>添加到resttemplate中</p><p></code>\`<code>plain
@Bean@LoadBalancedRestTemplate restTemplate() {	RestTemplate restTemplate = new RestTemplate();	restTemplate.getInterceptors().add(new LoggingClientHttpRequestInterceptor());	return restTemplate;}
</code>\`<code></p><p><h2>ribbon</h2></p><p><h3>两种负载均衡</h3></p><p>​ 当系统面临大量的用户访问-负载过高的时候-通常会增加服务器数量来进行横向扩展（集群）-多个服务器的负载需要均衡-以免出现服务器负载不均衡-部分服务器负载较大-部分服务器负载较小的情况。通过负载均衡-使得集群中服务器的负载保持在稳定高效的状态-从而提高整个系统的处理能力。</p><p></code>\`<code>sh
软件负载均衡：nginx,lvs硬件负载均衡：F5我们只关注软件负载均衡-第一层可以用DNS-配置多个A记录-让DNS做第一层分发。第二层用比较流行的是反向代理-核心原理：代理根据一定规则-将http请求转发到服务器集群的单一服务器上。
</code>\`<code></p><p>软件负载均衡分为：服务端（集中式）-客户端。</p><p>服务端负载均衡：在客户端和服务端中间使用代理-nginx。</p><p>客户端负载均衡：根据自己的情况做负载。Ribbon就是。</p><p>客户端负载均衡和服务端负载均衡最大的区别在于 <strong>_服务端地址列表的存储位置-以及负载算法在哪里_</strong>。</p><p><h3>客户端负载均衡</h3></p><p>在客户端负载均衡中-所有的客户端节点都有一份自己要访问的服务端地址列表-这些列表统统都是从服务注册中心获取的；</p><p><h3>服务端负载均衡</h3></p><p>在服务端负载均衡中-客户端节点只知道单一服务代理`,
    author: defaultAuthor,
    readTime: '17 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Zuul Gateway: Principles and Usage",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-07-28-zuul',
    date: 'July 28, 2020',
    category: 'Distributed Systems',
    tags: ["Spring Cloud","Framework","Microservices"],
    slug: '2020-07-28-zuul',
    content: `<p><h1>网关</h1></p><p>Starter阿里云镜像</p><p><a href="https://start.aliyun.com/">https://start.aliyun.com/</a></p><p><h2>概念</h2></p><p>微服务基本模块已经有了-也可以做微服务了。但完成一个复杂的业务-可能需要多个微服务合作来完成-比如下单-需要用户服务-支付服务-地图服务-订单服务。一般是我们对外服务的窗口-进行服务内外隔离。一般微服务都在内网-不做安全验证-</p><p>就好像：很多明星-可以独立开演唱会（独立提供服务）。也可以去春晚（微服务群提供服务）。但一台春晚就不能让 观众一个一个调用了。观众要调用-需要检票啥的-检票就类似于网关-进来之后-界面随便看-不会说你 看个小品-还需要再检票。</p><p>微服务没有网关-会有下面的问题：</p><p><li> 客户端请求多个微服务-增加了客户端复杂性-每个微服务都要做用户认证-限流等-避免和多个微服务打交道的复杂性。</li>
<li> 有跨域问题-不在同一个域。</li>
<li> 认证复杂-每个服务都要独立认证-服务要求的权限不一致。</li>
<li> 难以重构。因为微服务被客户端调用着-重构难以实施。</li></p><p>网关是介于客户端（外部调用方比如app-h5）和微服务的中间层。</p><p>Zuul是Netflix开源的微服务网关-核心是一系列过滤器。这些过滤器可以完成以下功能。</p><p><li> 是所有微服务入口-进行分发。</li>
<li> 身份认证与安全。识别合法的请求-拦截不合法的请求。</li>
<li> 监控。在入口处监控-更全面。</li>
<li> 动态路由。动态将请求分发到不同的后端集群。</li>
<li> 压力测试。可以逐渐增加对后端服务的流量-进行测试。</li>
<li> 负载均衡。也是用ribbon。</li>
<li> 限流（望京超市）。比如我每秒只要1000次-10001次就不让访问了。</li>
<li> 服务熔断</li></p><p>网关和服务的关系：演员和剧场检票人员的关系。</p><p>zuul默认集成了：ribbon和hystrix。</p><p><h2>启用网关</h2></p><p>新建项目引入依赖</p><p>\`\`<code>plain
	org.springframework.cloud	spring-cloud-starter-netflix-eureka-client	org.springframework.cloud	spring-cloud-starter-netflix-zuul
</code>\`<code></p><p>配置文件</p><p></code>\`<code>plain
eureka.client.service-url.defaultZone=http://euk1.com:7001/eureka/spring.application.name=zuulserverserver.port=80
</code>\`<code></p><p>启动类</p><p></code>\`<code>plain
@EnableZuulProxy
</code>\`<code></p><p>测试访问</p><p>网关会将服务名转换成具体服务的ip和端口-实际进行访问</p><p></code>\`<code>plain
http://localhost/consumer/alive
</code>\`<code></p><p><h3>负载均衡</h3></p><p>启动两个Consumer</p><p>轮询访问上面地址-会看到返回结果中-端口一直轮询在变。说明负载均衡生效了-默认是轮询</p><p></code>\`<code>plain
consumer.ribbon.NFLoadBalancerRuleClassName=com.netflix.loadbalancer.RandomRule
</code>\`<code></p><p><h3>路由端点</h3></p><p>调试的时候-看网关请求的地址-以及 映射是否正确。网关请求有误时-可以通过此处排查错误。</p><p>配置</p><p></code>\`<code>plain
management.endpoints.web.exposure.include=*management.endpoint.health.show-details=alwaysmanagement.endpoint.health.enabled=truemanagement.endpoint.routes.enabled=true
</code>\`<code></p><p><h3>配置指定微服务的访问路径</h3></p><p><li> 通过服务名配置（虚拟主机名）</li></p><p></code>\`<code>sh
zuul.routes.consumer=/xxoo/**
</code>\`<code></p><p>配置前先访问-然后做对比。</p><p>2.自定义映射</p><p></code>\`<code>plain
zuul.routes.xx.path=/xx/**zuul.routes.xx.url=http://mashibing.com
</code>\`<code></p><p><li> .自定义下的负载均衡</li></p><p></code>\`<code>plain
zuul.routes.xx.path=/xx/**zuul.routes.xx.service-id=cuidcuid.ribbon.listOfServers=localhost:82,localhost:83ribbon.eureka.enabled=false
</code>\`<code></p><p><h3>忽略微服务</h3></p><p>配置</p><p></code>\`<code>plain
zuul.ignored-services=user-provider
</code>\`<code></p><p><h3>前缀</h3></p><p></code>\`<code>plain
zuul.prefix=/api/v1
</code>\`<code></p><p>带上前缀请求</p><p></code>\`<code>plain
zuul.strip-prefix=false
</code>\`<code></p><p><h3>高可用</h3></p><p>Nginx + Keepalive</p><p><h3>敏感Header</h3></p><p>测试点：</p><p>停止一个api-driver。访问：yapi：网关token-看返回。</p><p>初始请求。返回值中token为msb cookie</p><p>加上下面配置</p><p>敏感的header不会传播到下游去-也就是说此处的token不会传播的其它的微服务中去。</p><p></code>\`<code>sh
zuul:  #一下配置-表示忽略下面的值向微服务传播-以下配置为空表示：所有请求头都透传到后面微服务。  sensitive-headers: token
</code>\`<code></p><p>访问。网关token为null。</p><p>---</p><p>上面是网关的路由。</p><p><h3>过滤器</h3></p><p>Zuul的大部分功能都是有过滤器实现的。</p><p>4种过滤器</p><p></code>\`<code>sh
PRE: 在请求被路由之前调用-可利用这种过滤器实现身份验证。选择微服务-记录日志。ROUTING:在将请求路由到微服务调用-用于构建发送给微服务的请求-并用http clinet（或者ribbon）请求微服务。POST:在调用微服务执行后。可用于添加header-记录日志-将响应发给客户端。ERROR:在其他阶段发生错误是-走此过滤器。
</code>\`<code></p><p>自定义过滤器</p><p></code>\`<code>sh
PreFilter看代码-注意下面4点。filterType：pre-routing,post,errorfilterOrder:执行顺序-在谁前-在谁后-可以+1--1shouldFilter：此过滤器是否执行-true  false-可以写过滤器是否执行的判断条件。run：具体执行逻辑。
</code>\`<code></p><p>访问：yapi中 网关token</p><p></code>\`<code>sh
pre来源uri：/api-driver/test/tokenpre拦截pre 业务逻辑 token:msb coolie
</code>\`<code></p><p>说一下AuthFilter。利用filter实现了 鉴权。看代码。（实际用jwt）</p><p>测试一下-</p><p></code>\`<code>sh
// 测试路径//		if(uri.contains("api-driver")) {//			return true;//		}
</code>\`<code></p><p><h3>接口容错</h3></p><p></code>\`<code>sh
@Componentpublic class MsbFallback implements FallbackProvider{	/**	 * 表明为哪个微服务提供回退	 * 服务Id -若需要所有服务调用都支持回退-返回null 或者 * 即可	 */	@Override	public String getRoute() {		// TODO Auto-generated method stub		return "*";	}	@Override	public ClientHttpResponse fallbackResponse(String route, Throwable cause) {				if (cause instanceof HystrixTimeoutException) {            return response(HttpStatus.GATEWAY_TIMEOUT);        } else {            return response(HttpStatus.INTERNAL_SERVER_ERROR);        }					}		private ClientHttpResponse response(final HttpStatus status) {        return new ClientHttpResponse() {            @Override            public HttpStatus getStatusCode() throws IOException {                //return status;                return HttpStatus.BAD_REQUEST;            }            @Override            public int getRawStatusCode() throws IOException {                //return status.value();                return HttpStatus.BAD_REQUEST.value();            }            @Override            public String getStatusText() throws IOException {                //return s`,
    author: defaultAuthor,
    readTime: '67 min read',
    relatedPosts: ["2020-06-23-spring-cloud-eurekaactuator","2020-07-02"],
  },
  {
    title: "Spring Cloud Sleuth: Distributed Tracing",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-07-29-sleuth',
    date: 'July 29, 2020',
    category: 'Distributed Systems',
    tags: ["Spring Cloud","Framework","Microservices"],
    slug: '2020-07-29-sleuth',
    content: `<p><h1>链路追踪</h1></p><p><h2>1 概念</h2></p><p><h3>分布式计算八大误区</h3></p><p>网络可靠。</p><p>延迟为零。</p><p>带宽无限。</p><p>网络绝对安全。</p><p>网络拓扑不会改变。</p><p>必须有一名管理员。</p><p>传输成本为零。</p><p>网络同质化。（操作系统-协议）</p><p><h3>链路追踪的必要性</h3></p><p>如果能跟踪每个请求-中间请求经过哪些微服务-请求耗时-网络延迟-业务逻辑耗时等。我们就能更好地分析系统瓶颈、解决系统问题。因此链路跟踪很重要。</p><p>> 《链路追踪》看看微服务之熵。</p><p>我们自己思考解决方案：在调用前后加时间戳。捕获异常。</p><p>链路追踪目的：解决错综复杂的服务调用中链路的查看。排查慢服务。</p><p>市面上链路追踪产品-大部分基于google的Dapper论文。</p><p>\`\`<code>sh
zipkin,twitter开源的。是严格按照谷歌的Dapper论文来的。pinpoint 韩国的 Naver公司的。Cat 美团点评的EagleEye 淘宝的
</code>\`<code></p><p><h3>链路追踪要考虑的几个问题</h3></p><p><li> 探针的性能消耗。尽量不影响 服务本尊。</li>
<li> 易用。开发可以很快接入-别浪费太多精力。</li>
<li> 数据分析。要实时分析。维度足够。</li></p><p><h3>Sleuth简介</h3></p><p>Sleuth是Spring cloud的分布式跟踪解决方案。</p><p><li> span(跨度)-基本工作单元。一次链路调用-创建一个span-</li></p><p>    span用一个64位id唯一标识。包括：id-描述-时间戳事件-spanId,span父id。</p><p>    span被启动和停止时-记录了时间信息-初始化span叫：root span-它的span id和trace id相等。</p><p><li> trace(跟踪)-一组共享“root span”的span组成的树状结构 称为 trace-trace也有一个64位ID-trace中所有span共享一个trace id。类似于一颗 span 树。</li>
<li> annotation（标签）-annotation用来记录事件的存在-其中-核心annotation用来定义请求的开始和结束。</li>
    - CS(Client Send客户端发起请求)。客户端发起请求描述了span开始。
    - SR(Server Received服务端接到请求)。服务端获得请求并准备处理它。SR-CS=网络延迟。
    - SS（Server Send服务器端处理完成-并将结果发送给客户端）。表示服务器完成请求处理-响应客户端时。SS-SR=服务器处理请求的时间。
    - CR（Client Received 客户端接受服务端信息）。span结束的标识。客户端接收到服务器的响应。CR-CS=客户端发出请求到服务器响应的总时间。</p><p>其实数据结构是一颗树-从root span 开始。</p><p>> 《链路树演示》</p><p><h2>2 使用</h2></p><p>#### Sleuth单独</p><p><li> pom</li></p><p>    每个需要监控的系统</p><p></code>\`<code>sh
					org.springframework.cloud			spring-cloud-starter-sleuth
</code>\`<code></p><p>测试点：</p><p><li> 启动eureka 7900-service-sms 8002-api-driver 9002.</li>
<li> 访问一次。看日志结果。</li></p><p></code>\`<code>sh
[api-driver,1a409c98e7a3cdbf,1a409c98e7a3cdbf,true]   [服务名称-traceId（一条请求调用链中 唯一ID）-spanID（基本的工作单元-获取数据等）-是否让zipkin收集和展示此信息]看下游[service-sms,1a409c98e7a3cdbf,b3d93470b5cf8434,true]traceId- 是一样的。服务名必须得写。
</code>\`<code></p><p>#### zipkin</p><p>上面拍错看日志-很原始。刀耕火种-加入利器 zipkin。</p><p>zipkin是twitter开源的分布式跟踪系统。</p><p>原理收集系统的时序数据-从而追踪微服务架构中系统延时等问题。还有一个友好的界面。</p><p>由4个部分组成：</p><p>Collector、Storage、Restful API、Web UI组成</p><p>采集器-存储器-接口-UI。</p><p>原理：</p><p>sleuth收集跟踪信息通过http请求发送给zipkin server-zipkin将跟踪信息存储-以及提供RESTful API接口-zipkin ui通过调用api进行数据展示。</p><p>默认内存存储-可以用mysql-ES等存储。</p><p>操作步骤：</p><p><li> 每个需要监听的服务的pom中添加。</li></p><p></code>\`<code>sh
					org.springframework.cloud			spring-cloud-starter-zipkin
</code>\`<code></p><p><li> 每个需要监听的服务yml中</li></p><p></code>\`<code>sh
spring:  #zipkin  zipkin:    base-url: http://localhost:9411/    #采样比例1  sleuth:    sampler:      rate: 1
</code>\`<code></p><p><li> 启动zipkin。</li></p><p></code>\`<code>sh
jar包下载：curl -sSL https://zipkin.io/quickstart.sh | bash -s我放到了 目录：C:\github\online-taxi-demo  下面。java -jar zipkin.jar或者docker：docker run -d -p 9411:9411 openzipkin/zipkin
</code>\`<code></p><p>测试点：</p><p>访问zipkin：<a href="http://localhost:9411/zipkin/">http://localhost:9411/zipkin/</a></p><p>启动：eureka7900-service-sms 8002-api-driver 9002</p><p>发起一次 yapi ->api-driver->司机发送验证码。</p><p>观察zip界面-点查找-点依赖。</p><p>看查找下的时间。</p><p>再制造一次熔断-看看zipkin。停止service-sms-访问。会看到变红。</p><p>zipkin：最好和rabbitmq-mysql配合使用。</p><p><h1>健康检查</h1></p><p><h2>使用</h2></p><p><li> admin 组件端 = 项目：(cloud-admin)：pom</li></p><p></code>\`<code>sh
server端：					de.codecentric			spring-boot-admin-starter-server									de.codecentric			spring-boot-admin-server-ui
</code>\`<code></p><p><li> 每个需要监控的服务-都加</li></p><p></code>\`<code>sh
pom：	org.springframework.boot	spring-boot-starter-actuatoryml：management:  endpoints:    web:      exposure:        #yml加双引号-properties不用加        include: "*"     health:      ##默认是never      show-details: ALWAYS      enabled: true
</code>\`<code></p><p><li> 访问server</li></p><p></code>\`<code>sh
http://localhost:6010/root/root
</code>\`<code></p><p>小插曲 正六边形算法。</p><p><h2>邮件监控 -在admin组件中。</h2></p><p><li> pom</li></p><p>    </code>\`<code>sh
    			org.springframework.boot			spring-boot-starter-mail
    </code>\`<code></p><p><li> yml</li></p><p>    </code>\`<code>sh
    spring:   application:     name: cloud-admin  security:    user:      name: root      password: root  # 邮件设置  mail:    host: smtp.qq.com    username: 单纯QQ号    password: xxxxxxx授权码    properties:      mail:         smpt:           auth: true          starttls:             enable: true            required: true#收件邮箱spring.boot.admin.notify.mail.to: 2634982208@qq.com   # 发件邮箱spring.boot.admin.notify.mail.from: xxxxxxx@qq.com
    </code>\`\`</p><p><li> 下线一个服务。</li>
<li> 去邮箱查看。</li></p>`,
    author: defaultAuthor,
    readTime: '10 min read',
    relatedPosts: ["2020-06-23-spring-cloud-eurekaactuator","2020-07-02"],
  },
  {
    title: "Hystrix: Circuit Breaker Patterns",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-08-03-hystrix',
    date: 'August 3, 2020',
    category: 'Distributed Systems',
    tags: ["Spring Cloud","Framework","Microservices"],
    slug: '2020-08-03-hystrix',
    content: `<p><h1>Hystrix</h1></p><p><h2>1 概念：</h2></p><p><h3>概述</h3></p><p>​ 在分布式系统下-微服务之间不可避免地会发生相互调用-但每个系统都无法百分之百保证自身运行不出问题。在服务调用中-很可能面临依赖服务失效的问题（网络延时-服务异常-负载过大无法及时响应）。因此需要一个组件-能提供强大的容错能力-为服务间调用提供保护和控制。</p><p>我们的目的：<strong>_当我自身 依赖的服务不可用时-服务自身不会被拖垮。防止微服务级联异常_</strong>。</p><p>图。</p><p>本质：就是隔离坏的服务-不让坏服务拖垮其他服务（调用坏服务的服务）。</p><p>比如：武汉发生疫情-隔离它-不让依赖于武汉的地方感染。</p><p>和我们课程中熔断降级更贴切一点：北京从武汉招聘大学生-武汉有疫情了-当北京去武汉请求大学生来的时候-武汉熔断-然后北京启动自身的备用逻辑：去上海找大学生（降级）。</p><p><h3>舱壁模式</h3></p><p>舱壁模式（Bulkhead）隔离了每个工作负载或服务的关键资源-如连接池、内存和CPU-硬盘。每个工作单元都有独立的 连接池-内存-CPU。</p><p>使用舱壁避免了单个服务消耗掉所有资源-从而导致其他服务出现故障的场景。  
这种模式主要是通过防止由一个服务引起的级联故障来增加系统的弹性。</p><p>据说泰坦尼克原因：泰坦尼克号上有16个防水舱-设计可以保障如果只有4个舱进水-密闭和隔离可以阻止水继续进入下一个防水舱-从而保证船的基本浮力。</p><p>但是当时冰山从侧面划破了船体-从而导致有5个防水舱同时进水-而为了建造豪华的头等舱大厅-也就是电影里杰克和罗斯约会的地方-5号舱的顶部并未达到密闭所需要的高度-水就一层层进入了船体-隔离的失败导致了泰坦尼克的沉没。</p><p>> 舱壁模式<img src="/images/blog/%E8%88%B1%E5%A3%81%E6%A8%A1%E5%BC%8F.png" alt="illustration" class="my-4" /></p><p>给我们的思路：可以对每个请求设置-单独的连接池-配置连接数-不要影响 别的请求。就像一个一个的防水舱。</p><p>对在公司中的管理也一样：给每个独立的 小组-分配独立的资源-比如产品-开发-测试。在小公司-大多数情况 这些资源都是共享的-有一个好处是充分利用资源-坏处是-如果一个项目延期-会影响别的项目推进。自己权衡利弊。</p><p>最近比较火的一句话： 真正的知识-是 产品提高一个等级和成本提高0.2元的 痛苦抉择。</p><p><h3>雪崩效应</h3></p><p>​ 每个服务 发出一个HTTP请求都会 在 服务中 开启一个新线程。而下游服务挂了或者网络不可达-通常线程会阻塞住-直到Timeout。如果并发量多一点-这些阻塞的线程就会占用大量的资源-很有可能把自己本身这个微服务所在的机器资源耗尽-导致自己也挂掉。</p><p>​ 如果服务提供者响应非常缓慢-那么服务消费者调用此提供者就会一直等待-直到提供者响应或超时。在高并发场景下-此种情况-如果不做任何处理-就会导致服务消费者的资源耗竭甚至整个系统的崩溃。一层一层的崩溃-导致所有的系统崩溃。</p><p>> 《雪崩示意图》<img src="/images/blog/%E9%9B%AA%E5%B4%A9%E7%A4%BA%E6%84%8F%E5%9B%BE.png" alt="illustration" class="my-4" /></p><p>​ 雪崩：由基础服务故障导致级联故障的现象。描述的是：提供者不可用 导致消费者不可用-并将不可用逐渐放大的过程。像滚雪球一样-不可用的服务越来越多。影响越来越恶劣。</p><p>雪崩三个流程：</p><p>服务提供者不可用</p><p>重试会导致网络流量加大-更影响服务提供者。</p><p>导致服务调用者不可用-由于服务调用者 一直等待返回-一直占用系统资源。</p><p>（不可用的范围 被逐步放大）</p><p>服务不可用原因：</p><p>服务器宕机</p><p>网络故障</p><p>宕机</p><p>程序异常</p><p>负载过大-导致服务提供者响应慢</p><p>缓存击穿导致服务超负荷运行</p><p>总之 ： 基础服务故障 导致 级联故障 就是 雪崩。</p><p><h3>容错机制</h3></p><p><li> 为网络请求设置超时。</li></p><p>    必须为网络请求设置超时。一般的调用一般在几十毫秒内响应。如果服务不可用-或者网络有问题-那么响应时间会变很长。长到几十秒。</p><p>    每一次调用-对应一个线程或进程-如果响应时间长-那么线程就长时间得不到释放-而线程对应着系统资源-包括CPU,内存-得不到释放的线程越多-资源被消耗的越多-最终导致系统崩溃。</p><p>    因此必须设置超时时间-让资源尽快释放。</p><p><li> 使用断路器模式。</li></p><p>    想一下家里的保险丝-跳闸。如果家里有短路或者大功率电器使用-超过电路负载时-就会跳闸-如果不跳闸-电路烧毁-波及到其他家庭-导致其他家庭也不可用。通过跳闸保护电路安全-当短路问题-或者大功率问题被解决-在合闸。</p><p>    自己家里电路-不影响整个小区每家每户的电路。</p><p><h3>断路器</h3></p><p>\`\`<code>
如果对某个微服务请求有大量超时（说明该服务不可用）-再让新的请求访问该服务就没有意义-只会无谓的消耗资源。例如设置了超时时间1s-如果短时间内有大量的请求无法在1s内响应-就没有必要去请求依赖的服务了。
</code>\`<code></p><p><li> 断路器是对容易导致错误的操作的代理。这种代理能统计一段时间内的失败次数-并依据次数决定是正常请求依赖的服务还是直接返回。</li>
<li> 断路器可以实现快速失败-如果它在一段时间内检测到许多类似的错误（超时）-就会在之后的一段时间-强迫对该服务的调用快速失败-即不再请求所调用的服务。这样对于消费者就无须再浪费CPU去等待长时间的超时。</li>
<li> 断路器也可自动诊断依赖的服务是否恢复正常。如果发现依赖的服务已经恢复正常-那么就会恢复请求该服务。通过重置时间来决定断路器的重新闭合。</li></p><p>    这样就实现了微服务的“自我修复”：当依赖的服务不可用时-打开断路器-让服务快速失败-从而防止雪崩。当依赖的服务恢复正常时-又恢复请求。</p><p>> 断路器开关时序图<img src="/images/blog/%E6%96%AD%E8%B7%AF%E5%99%A8%E5%BC%80%E5%85%B3%E6%97%B6%E5%BA%8F%E5%9B%BE.png" alt="illustration" class="my-4" /></p><p></code>\`<code>sh
第一次正常第二次提供者异常提供者多次异常后-断路器打开后续请求-则直接降级-走备用逻辑。
</code>\`<code></p><p>​ 断路器状态转换的逻辑：</p><p></code>\`<code>plain
关闭状态：正常情况下-断路器关闭-可以正常请求依赖的服务。打开状态：当一段时间内-请求失败率达到一定阈值-断路器就会打开。服务请求不会去请求依赖的服务。调用方直接返回。不发生真正的调用。重置时间过后-进入半开模式。半开状态：断路器打开一段时间后-会自动进入“半开模式”-此时-断路器允许一个服务请求访问依赖的服务。如果此请求成功(或者成功达到一定比例)-则关闭断路器-恢复正常访问。否则-则继续保持打开状态。断路器的打开-能保证服务调用者在调用异常服务时-快速返回结果-避免大量的同步等待-减少服务调用者的资源消耗。并且断路器能在打开一段时间后继续侦测请求执行结果-判断断路器是否能关闭-恢复服务的正常调用。
</code>\`<code></p><p>> 《熔断.doc》《断路器开关时序图》《状态转换》</p><p><h3>降级</h3></p><p>为了在整体资源不够的时候-适当放弃部分服务-将主要的资源投放到核心服务中-待渡过难关之后-再重启已关闭的服务-保证了系统核心服务的稳定。当服务停掉后-自动进入fallback替换主方法。</p><p>用fallback方法代替主方法执行并返回结果-对失败的服务进行降级。当调用服务失败次数在一段时间内超过了断路器的阈值时-断路器将打开-不再进行真正的调用-而是快速失败-直接执行fallback逻辑。服务降级保护了服务调用者的逻辑。</p><p></code>\`<code>sh
熔断和降级：共同点：	1、为了防止系统崩溃-保证主要功能的可用性和可靠性。	2、用户体验到某些功能不能用。不同点：	1、熔断由下级故障触发-主动惹祸。	2、降级由调用方从负荷角度触发-无辜被抛弃。
</code>\`<code></p><p>19年春晚 百度 红包-凤巢的5万台机器熄火4小时-让给了红包。</p><p><h3>Hystrix</h3></p><p>spring cloud 用的是 hystrix-是一个容错组件。</p><p>Hystrix实现了 超时机制和断路器模式。</p><p>Hystrix是Netflix开源的一个类库-用于隔离远程系统、服务或者第三方库-防止级联失败-从而提升系统的可用性与容错性。主要有以下几点功能：</p><p><li> 为系统提供保护机制。在依赖的服务出现高延迟或失败时-为系统提供保护和控制。</li>
<li> 防止雪崩。</li>
<li> 包裹请求：使用HystrixCommand（或HystrixObservableCommand）包裹对依赖的调用逻辑-每个命令在独立线程中运行。</li>
<li> 跳闸机制：当某服务失败率达到一定的阈值时-Hystrix可以自动跳闸-停止请求该服务一段时间。</li>
<li> 资源隔离：Hystrix为每个请求都的依赖都维护了一个小型线程池-如果该线程池已满-发往该依赖的请求就被立即拒绝-而不是排队等候-从而加速失败判定。防止级联失败。</li>
<li> 快速失败：Fail Fast。同时能快速恢复。侧重点是：（不去真正的请求服务-发生异常再返回）-而是直接失败。</li>
<li> 监控：Hystrix可以实时监控运行指标和配置的变化-提供近实时的监控、报警、运维控制。</li>
<li> 回退机制：fallback-当请求失败、超时、被拒绝-或当断路器被打开时-执行回退逻辑。回退逻辑我们自定义-提供优雅的服务降级。</li>
<li> 自我修复：断路器打开一段时间后-会自动进入“半开”状态-可以进行打开-关闭-半开状态的转换。前面有介绍。</li></p><p><h2>2 Hystrix 使用</h2></p><p><h3>hystrix独立使用脱离spring cloud</h3></p><p>代码：study-hystrix项目-HelloWorldHystrixCommand类。看着类讲解。</p><p>关注点：</p><p>继承hystrixCommand</p><p>重写run</p><p>fallback（程序发生非HystrixBadRequestException异常-运行超时-熔断开关打开-线程池/信号量满了）</p><p>熔断（熔断机制相当于电路的跳闸功能-我们可以配置熔断策略为当请求错误比例在10s内>50%时-该服务将进入熔断状态-后续请求都会进入fallback。）</p><p>结果缓存（支持将一个请求结果缓存起来-下一个具有相同key的请求将直接从缓存中取出结果-减少请求开销。）</p><p>这个例子-只是独立使用hystrix- 通过这个例子-了解 hystrix `,
    author: defaultAuthor,
    readTime: '100 min read',
    relatedPosts: ["2020-06-23-spring-cloud-eurekaactuator","2020-07-02"],
  },
  {
    title: "MySQL Master-Slave Replication Setup",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-08-03-mysql',
    date: 'August 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-08-03-mysql',
    content: `<p><h1>MySQL主从复制原理</h1></p><p><h3>0、为什么需要主从复制？</h3></p><p>1、在业务复杂的系统中-有这么一个情景-有一句sql语句需要锁表-导致暂时不能使用读的服务-那么就很影响运行中的业务-使用主从复制-让主库负责写-从库负责读-这样-即使主库出现了锁表的情景-通过读从库也可以保证业务的正常运作。</p><p>2、做数据的热备</p><p>3、架构的扩展。业务量越来越大-I/O访问频率过高-单机无法满足-此时做多库的存储-降低磁盘I/O访问的频率-提高单个机器的I/O性能。</p><p><h3>1、什么是MySQL的主从复制？</h3></p><p>​ MySQL 主从复制是指数据可以从一个MySQL数据库服务器主节点复制到一个或多个从节点。MySQL 默认采用异步复制方式-这样从节点不用一直访问主服务器来更新自己的数据-数据的更新可以在远程连接上进行-从节点可以复制主数据库中的所有数据库或者特定的数据库-或者特定的表。</p><p><h3>2、MySQL复制原理</h3></p><p>##### 原理：</p><p>​ （1）master服务器将数据的改变记录二进制binlog日志-当master上的数据发生改变时-则将其改变写入二进制日志中；</p><p>​ （2）slave服务器会在一定时间间隔内对master二进制日志进行探测其是否发生改变-如果发生改变-则开始一个I/OThread请求master二进制事件</p><p>​ （3）同时主节点为每个I/O线程启动一个dump线程-用于向其发送二进制事件-并保存至从节点本地的中继日志中-从节点将启动SQL线程从中继日志中读取二进制日志-在本地重放-使得其数据和主节点的保持一致-最后I/OThread和SQLThread将进入睡眠状态-等待下一次被唤醒。</p><p>##### 也就是说：</p><p><li>从库会生成两个线程,一个I/O线程,一个SQL线程;</li>
<li>I/O线程会去请求主库的binlog,并将得到的binlog写到本地的relay-log(中继日志)文件中;</li>
<li>主库会生成一个log dump线程,用来给从库I/O线程传binlog;</li>
<li>SQL线程,会读取relay log文件中的日志,并解析成sql语句逐一执行;</li></p><p>##### 注意：</p><p>1–master将操作语句记录到binlog日志中-然后授予slave远程连接的权限（master一定要开启binlog二进制日志功能；通常为了数据安全考虑-slave也开启binlog功能）。  
2–slave开启两个线程：IO线程和SQL线程。其中：IO线程负责读取master的binlog内容到中继日志relay log里；SQL线程负责从relay log日志里读出binlog内容-并更新到slave的数据库里-这样就能保证slave数据和master数据保持一致了。  
3–Mysql复制至少需要两个Mysql的服务-当然Mysql服务可以分布在不同的服务器上-也可以在一台服务器上启动多个服务。  
4–Mysql复制最好确保master和slave服务器上的Mysql版本相同（如果不能满足版本一致-那么要保证master主节点的版本低于slave从节点的版本）  
5–master和slave两节点间时间需同步</p><p><img src="/images/blog/%E4%B8%BB%E4%BB%8E%E5%8E%9F%E7%90%86.png" alt="illustration" class="my-4" /></p><p>##### 具体步骤：</p><p>1、从库通过手工执行change master to 语句连接主库-提供了连接的用户一切条件（user 、password、port、ip）-并且让从库知道-二进制日志的起点位置（file名 position 号）； start slave</p><p>2、从库的IO线程和主库的dump线程建立连接。</p><p>3、从库根据change master to 语句提供的file名和position号-IO线程向主库发起binlog的请求。</p><p>4、主库dump线程根据从库的请求-将本地binlog以events的方式发给从库IO线程。</p><p>5、从库IO线程接收binlog events-并存放到本地relay-log中-传送过来的信息-会记录到master.info中</p><p>6、从库SQL线程应用relay-log-并且把应用过的记录到relay-log.info中-默认情况下-已经应用过的relay 会自动被清理purge</p><p><h3>3、MySQL主从形式</h3></p><p>##### （一）一主一从</p><p><img src="/images/blog/1570714549624.png" alt="illustration" class="my-4" /></p><p>##### （二）主主复制</p><p><img src="/images/blog/1570714565647.png" alt="illustration" class="my-4" /></p><p>##### （三）一主多从</p><p><img src="/images/blog/1570714576819.png" alt="illustration" class="my-4" /></p><p>##### （四）多主一从</p><p><img src="/images/blog/1570714615915.png" alt="illustration" class="my-4" /></p><p>##### （五）联级复制</p><p><img src="/images/blog/1570714660961-1594043182444.png" alt="illustration" class="my-4" /></p><p><h3>4、MySQL主从同步延时分析</h3></p><p>​ mysql的主从复制都是单线程的操作-主库对所有DDL和DML产生的日志写进binlog-由于binlog是顺序写-所以效率很高-slave的sql thread线程将主库的DDL和DML操作事件在slave中重放。DML和DDL的IO操作是随机的-不是顺序-所以成本要高很多-另一方面-由于sql thread也是单线程的-当主库的并发较高时-产生的DML数量超过slave的SQL thread所能处理的速度-或者当slave中有大型query语句产生了锁等待-那么延时就产生了。</p><p>​ 解决方案：</p><p>​ 1.业务的持久化层的实现采用分库架构-mysql服务可平行扩展-分散压力。</p><p>​ 2.单个库读写分离-一主多从-主写从读-分散压力。这样从库压力比主库高-保护主库。</p><p>​ 3.服务的基础架构在业务和mysql之间加入memcache或者redis的cache层。降低mysql的读压力。</p><p>​ 4.不同业务的mysql物理上放在不同机器-分散压力。</p><p>​ 5.使用比主库更好的硬件设备作为slave-mysql压力小-延迟自然会变小。</p><p>​ 6.使用更加强劲的硬件设备</p><p><h1>MySQL主从复制安装配置</h1></p><p><h3>1、基础设置准备</h3></p><p>\`\`<code>shell
#操作系统：centos6.5#mysql版本：5.7#两台虚拟机：node1:192.168.85.111（主）node2:192.168.85.112（从）
</code>\`<code></p><p><h3>2、安装MySQL数据库</h3></p><p></code>\`<code>shell
#详细安装和卸载的步骤参考对应的文档
</code>\`<code></p><p><h3>3、在两台数据库中分别创建数据库</h3></p><p></code>\`<code>sql
--注意两台必须全部执行create database msb;
</code>\`<code></p><p><h3>4、在主（node1）服务器进行如下配置：</h3></p><p></code>\`<code>shell
#修改配置文件-执行以下命令打开mysql配置文件vi /etc/my.cnf#在mysqld模块中添加如下配置信息log-bin=master-bin #二进制文件名称binlog-format=ROW  #二进制日志格式-有row、statement、mixed三种格式-row指的是把改变的内容复制过去-而不是把命令在从服务器上执行一遍-statement指的是在主服务器上执行的SQL语句-在从服务器上执行同样的语句。MySQL默认采用基于语句的复制-效率比较高。mixed指的是默认采用基于语句的复制-一旦发现基于语句的无法精确的复制时-就会采用基于行的复制。server-id=1		   #要求各个服务器的id必须不一样binlog-do-db=msb   #同步的数据库名称
</code>\`<code></p><p><h3>5、配置从服务器登录主服务器的账号授权</h3></p><p></code>\`<code>sql
--授权操作set global validate_password_policy=0;set global validate_password_length=1;grant replication slave on *.* to 'root'@'%' identified by '123456';--刷新权限flush privileges;
</code>\`<code></p><p><h3>6、从服务器的配置</h3></p><p></code>\`<code>shell
#修改配置文件-执行以下命令打开mysql配置文件vi /etc/my.cnf#在mysqld模块中添加如下配置信息log-bin=master-bin	#二进制文件的名称binlog-format=ROW	#二进制文件的格式server-id=2			#服务器的id
</code>\`<code></p><p><h3>7、重启主服务器的mysqld服务</h3></p><p></code>\`<code>shell
#重启mysql服务service mysqld restart#登录mysql数据库mysql -uroot -p#查看master的状态show master status；
</code>\`<code></p><p><img src="/images/blog/1570703264912.png" alt="illustration" class="my-4" /></p><p><h3>8、重启从服务器并进行相关配置</h3></p><p></code>\`<code>shell
#重启mysql服务service mysqld restart#登录mysqlmysql -uroot -p#连接主服务器change master to master_host='192.168.85.11',master_user='root',master_password='123456',master_port=3306,master_log_file='master-bin.000001',master_log_pos=154;#启动slavestart slave#查看slave的状态show slave status\G(注意没有分号)
</code>\`\`</p><p><h3>9、此时可以在主服务器进行相关的数据添加删除工作-在从服务器看相`,
    author: defaultAuthor,
    readTime: '11 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "MySQL MVCC: Multi-Version Concurrency Control",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-08-03-mysqlmvcc',
    date: 'August 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-08-03-mysqlmvcc',
    content: `<p><h2>Mysql中MVCC的使用及原理</h2></p><p><h3>准备</h3></p><p>数据库默认隔离级别：<strong>RR（Repeatable Read-可重复读）-MVCC主要适用于Mysql的RC,RR隔离级别</strong></p><p>创建一张存储引擎为testmvcc的表-sql为:</p><p>\`\`<code>html
CREATE TABLE testmvcc ( id int(11) DEFAULT NULL, name varchar(11) DEFAULT NULL) ENGINE=InnoDB
DEFAULT CHARSET=utf8;
</code>\`\`</p><p><h3>什么是MVCC?</h3></p><p>英文全称为Multi-Version Concurrency Control,翻译为中文即 多版本并发控制。在小编看来-他无非就是乐观锁的一种实现方式。在Java编程中-如果把乐观锁看成一个接口-MVCC便是这个接口的一个实现类而已。</p><p><img src="/images/blog/aHR0cDovL3A5LnBzdGF0cC5jb20vbGFyZ2UvcGdjLWltYWdlLzE1MzYyODkwMzA5MDRjMGRmMzFkYjM2" alt="illustration" class="my-4" /></p><p><h3>特点</h3></p><p>1.MVCC其实广泛应用于数据库技术-像Oracle,PostgreSQL等也引入了该技术-即适用范围广</p><p>2.MVCC并没有简单的使用数据库的行锁-而是使用了行级锁-row_level_lock,而非InnoDB中的innodb_row_lock.</p><p><h3>基本原理</h3></p><p>MVCC的实现-通过保存数据在某个时间点的快照来实现的。这意味着一个事务无论运行多长时间-在同一个事务里能够看到数据一致的视图。根据事务开始的时间不同-同时也意味着在同一个时刻不同事务看到的相同表里的数据可能是不同的。</p><p><h3>基本特征</h3></p><p><li>每行数据都存在一个版本-每次数据更新时都更新该版本。</li>
<li>修改时Copy出当前版本随意修改-各个事务之间无干扰。</li>
<li>保存时比较版本号-如果成功（commit）-则覆盖原记录；失败则放弃copy（rollback）</li></p><p><h3>InnoDB存储引擎MVCC的实现策略</h3></p><p>在每一行数据中额外保存两个隐藏的列：当前行创建时的版本号和删除时的版本号（可能为空-其实还有一列称为回滚指针-用于事务回滚-不在本文范畴）。这里的版本号并不是实际的时间值-而是系统版本号。每开始新的事务-系统版本号都会自动递增。事务开始时刻的系统版本号会作为事务的版本号-用来和查询每行记录的版本号进行比较。</p><p>每个事务又有自己的版本号-这样事务内执行CRUD操作时-就通过版本号的比较来达到数据版本控制的目的。</p><p><h3>MVCC下InnoDB的增删查改是怎么work的</h3></p><p>1、插入数据（insert）:记录的版本号即当前事务的版本号</p><p>执行一条数据语句：insert into testmvcc values(1,”test”);</p><p>假设事务id为1-那么插入后的数据行如下：</p><p><img src="/images/blog/aHR0cDovL3A5OC5wc3RhdHAuY29tL2xhcmdlL3BnYy1pbWFnZS8xNTM2Mjg2MzkyMDExMzMyZGM3OTk4MA" alt="illustration" class="my-4" /></p><p>2、在更新操作的时候-采用的是先标记旧的那行记录为已删除-并且删除版本号是事务版本号-然后插入一行新的记录的方式。</p><p>比如-针对上面那行记录-事务Id为2 要把name字段更新</p><p>update table set name= ‘new_value’ where id=1;</p><p><img src="/images/blog/aHR0cDovL3A5OC5wc3RhdHAuY29tL2xhcmdlL3BnYy1pbWFnZS8xNTM2Mjg2NDc5MDI2MmE4NTg5NmU1NQ" alt="illustration" class="my-4" /></p><p>3、删除操作的时候-就把事务版本号作为删除版本号。比如</p><p>delete from table where id=1;</p><p><img src="/images/blog/aHR0cDovL3A5LnBzdGF0cC5jb20vbGFyZ2UvcGdjLWltYWdlLzE1MzYyODY1MzI0MTUwZGZiYzdiZjY2" alt="illustration" class="my-4" /></p><p>4、查询操作：</p><p>从上面的描述可以看到-在查询时要符合以下两个条件的记录才能被事务查询出来：</p><p><li>删除版本号未指定或者大于当前事务版本号-即查询事务开启后确保读取的行未被删除。(即上述事务id为2的事务查询时-依然能读取到事务id为3所删除的数据行)</li></p><p><li>创建版本号 小于或者等于 当前事务版本号 -就是说记录创建是在当前事务中（等于的情况）或者在当前事务启动之前的其他事物进行的insert。</li></p><p>（即事务id为2的事务只能读取到create version<=2的已提交的事务的数据集）</p><p>> 补充：
>
> 1.MVCC手段只适用于Msyql隔离级别中的读已提交（Read committed）和可重复读（Repeatable Read）.
>
> 2.Read uncimmitted由于存在脏读-即能读到未提交事务的数据行-所以不适用MVCC.
>
> 原因是MVCC的创建版本和删除版本只要在事务提交后才会产生。
>
> 3.串行化由于是会对所涉及到的表加锁-并非行锁-自然也就不存在行的版本控制问题。
>
> 4.通过以上总结-可知-MVCC主要作用于事务性的-有行锁控制的数据库模型。</p><p><h3>关于Mysql中MVCC的总结</h3></p><p>客观上-我们认为他就是乐观锁的一整实现方式-就是每行都有版本号-保存时根据版本号决定是否成功。</p><p>了解乐观锁的小伙伴们都知道-其主要依靠版本控制-即消除锁定-二者相互矛盾-so从某种意义上来说-Mysql的MVCC并非真正的MVCC-他只是借用MVCC的名号实现了读的非阻塞而已。</p>`,
    author: defaultAuthor,
    readTime: '7 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "MySQL Locking Mechanisms",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-08-03-mysql',
    date: 'August 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-08-03-mysql',
    content: `<p><h1>MySQL的锁机制</h1></p><p><h3>1、MySQL锁</h3></p><p>​ <strong>锁是计算机协调多个进程或线程并发访问某一资源的机制。</strong>在数据库中-除传统的 计算资源（如CPU、RAM、I/O等）的争用以外-数据也是一种供许多用户共享的资源。如何保证数据并发访问的一致性、有效性是所有数据库必须解决的一 个问题-锁冲突也是影响数据库并发访问性能的一个重要因素。从这个角度来说-锁对数据库而言显得尤其重要-也更加复杂。</p><p>​ 相对其他数据库而言-MySQL的锁机制比较简单-其最 显著的特点是不同的<strong>存储引擎</strong>支持不同的锁机制。比如-MyISAM和MEMORY存储引擎采用的是表级锁（table-level locking）；InnoDB存储引擎既支持行级锁（row-level locking）-也支持表级锁-但默认情况下是采用行级锁。</p><p>​ <strong>表级锁：</strong>开销小-加锁快；不会出现死锁；锁定粒度大-发生锁冲突的概率最高-并发度最低。  
​ <strong>行级锁：</strong>开销大-加锁慢；会出现死锁；锁定粒度最小-发生锁冲突的概率最低-并发度也最高。</p><p>​ 从上述特点可见-很难笼统地说哪种锁更好-只能就具体应用的特点来说哪种锁更合适！仅从锁的角度 来说：表级锁更适合于以查询为主-只有少量按索引条件更新数据的应用-如Web应用；而行级锁则更适合于有大量按索引条件并发更新少量不同数据-同时又有 并发查询的应用-如一些在线事务处理（OLTP）系统。</p><p><h3>2、MyISAM表锁</h3></p><p>MySQL的表级锁有两种模式：<strong>表共享读锁（Table Read Lock）</strong>和<strong>表独占写锁（Table Write Lock）</strong>。</p><p>对MyISAM表的读操作-不会阻塞其他用户对同一表的读请求-但会阻塞对同一表的写请求；对 MyISAM表的写操作-则会阻塞其他用户对同一表的读和写操作；MyISAM表的读操作与写操作之间-以及写操作之间是串行的！</p><p>建表语句：</p><p>\`\`<code>sql
CREATE TABLE </code>mylock<code> (  </code>id<code> int(11) NOT NULL AUTO_INCREMENT,  </code>NAME<code> varchar(20) DEFAULT NULL,  PRIMARY KEY (</code>id<code>)) ENGINE=MyISAM DEFAULT CHARSET=utf8;INSERT INTO </code>mylock<code> (</code>id<code>, </code>NAME<code>) VALUES ('1', 'a');INSERT INTO </code>mylock<code> (</code>id<code>, </code>NAME<code>) VALUES ('2', 'b');INSERT INTO </code>mylock<code> (</code>id<code>, </code>NAME<code>) VALUES ('3', 'c');INSERT INTO </code>mylock<code> (</code>id<code>, </code>NAME<code>) VALUES ('4', 'd');
</code>\`<code></p><p><strong>MyISAM写锁阻塞读的案例：</strong></p><p>​ 当一个线程获得对一个表的写锁之后-只有持有锁的线程可以对表进行更新操作。其他线程的读写操作都会等待-直到锁释放为止。</p><p>session1</p><p>session2</p><p>获取表的write锁定  
lock table mylock write;</p><p>当前session对表的查询-插入-更新操作都可以执行  
select \* from mylock;  
insert into mylock values(5,’e’);</p><p>当前session对表的查询会被阻塞  
select \* from mylock；</p><p>释放锁：  
unlock tables；</p><p>当前session能够立刻执行-并返回对应结果</p><p><strong>MyISAM读阻塞写的案例：</strong></p><p>​ 一个session使用lock table给表加读锁-这个session可以锁定表中的记录-但更新和访问其他表都会提示错误-同时-另一个session可以查询表中的记录-但更新就会出现锁等待。</p><p>session1</p><p>session2</p><p>获得表的read锁定  
lock table mylock read;</p><p>当前session可以查询该表记录：  
select \* from mylock;</p><p>当前session可以查询该表记录：  
select \* from mylock;</p><p>当前session不能查询没有锁定的表  
select \* from person  
Table ‘person’ was not locked with LOCK TABLES</p><p>当前session可以查询或者更新未锁定的表  
select \* from mylock  
insert into person values(1,’zhangsan’);</p><p>当前session插入或者更新表会提示错误  
insert into mylock values(6,’f’)  
Table ‘mylock’ was locked with a READ lock and can’t be updated  
update mylock set name=’aa’ where id = 1;  
Table ‘mylock’ was locked with a READ lock and can’t be updated</p><p>当前session插入数据会等待获得锁  
insert into mylock values(6,’f’);</p><p>释放锁  
unlock tables;</p><p>获得锁-更新成功</p><p><strong>注意:</strong></p><p><strong>MyISAM在执行查询语句之前-会自动给涉及的所有表加读锁-在执行更新操作前-会自动给涉及的表加写锁-这个过程并不需要用户干预-因此用户一般不需要使用命令来显式加锁-上例中的加锁时为了演示效果。</strong></p><p><strong>MyISAM的并发插入问题</strong></p><p>MyISAM表的读和写是串行的-这是就总体而言的-在一定条件下-MyISAM也支持查询和插入操作的并发执行</p><p>session1</p><p>session2</p><p>获取表的read local锁定  
lock table mylock read local</p><p>当前session不能对表进行更新或者插入操作  
insert into mylock values(6,’f’)  
Table ‘mylock’ was locked with a READ lock and can’t be updated  
update mylock set name=’aa’ where id = 1;  
Table ‘mylock’ was locked with a READ lock and can’t be updated</p><p>其他session可以查询该表的记录  
select\* from mylock</p><p>当前session不能查询没有锁定的表  
select \* from person  
Table ‘person’ was not locked with LOCK TABLES</p><p>其他session可以进行插入操作-但是更新会阻塞  
update mylock set name = ‘aa’ where id = 1;</p><p>当前session不能访问其他session插入的记录；</p><p>释放锁资源：unlock tables</p><p>当前session获取锁-更新操作完成</p><p>当前session可以查看其他session插入的记录</p><p>可以通过检查table_locks_waited和table_locks_immediate状态变量来分析系统上的表锁定争夺：</p><p></code>\`<code>sql
mysql> show status like 'table%';+-----------------------+-------+| Variable_name         | Value |+-----------------------+-------+| Table_locks_immediate | 352   || Table_locks_waited    | 2     |+-----------------------+-------+--如果Table_locks_waited的值比较高-则说明存在着较严重的表级锁争用情况。
</code>\`<code></p><p><h3>3、InnoDB锁</h3></p><p><strong>1、事务及其ACID属性</strong></p><p>事务是由一组SQL语句组成的逻辑处理单元-事务具有4属性-通常称为事务的ACID属性。</p><p>原子性（Actomicity）：事务是一个原子操作单元-其对数据的修改-要么全都执行-要么全都不执行。  
一致性（Consistent）：在事务开始和完成时-数据都必须保持一致状态。  
隔离性（Isolation）：数据库系统提供一定的隔离机制-保证事务在不受外部并发操作影响的“独立”环境执行。  
持久性（Durable）：事务完成之后-它对于数据的修改是永久性的-即使出现系统故障也能够保持。</p><p><strong>2、并发事务带来的问题</strong></p><p>相对于串行处理来说-并发事务处理能大大增加数据库资源的利用率-提高数据库系统的事务吞吐量-从而可以支持更多用户的并发操作-但与此同时-会带来一下问题：</p><p><strong>脏读</strong>： 一个事务正在对一条记录做修改-在这个事务并提交前-这条记录的数据就处于不一致状态；这时-另一个事务也来读取同一条记录-如果不加控制-第二个事务读取了这些“脏”的数据-并据此做进一步的处理-就会产生未提交的数据依赖关系。这种现象被形象地叫做“脏读”</p><p><strong>不可重复读</strong>：一个事务在读取某些数据已经发生了改变、或某些记录已经被删除了！这种现象叫做“不可重复读”。</p><p><strong>幻读</strong>： 一个事务按相同的查询条件重新读取以前检索过的数据-却发现其他事务插入了满足其查询条件的新数据-这种现象就称为“幻读”</p><p>上述出现的问题都是数据库读一致性的问题-可以通过事务的隔离机制来进行保证。</p><p>数据库的事务隔离越严格-并发副作用就越小-但付出的代价也就越大-因为事务隔离本质上就是使事务在一定程度上串行化-需要根据具体的业务需求来决定使用哪种隔离级别</p><p>脏读</p><p>不可重复读</p><p>幻读</p><p>read unc`,
    author: defaultAuthor,
    readTime: '20 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "MySQL Practice Exercises",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-08-03-mysql',
    date: 'August 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-08-03-mysql',
    content: `<p><h2>MySQL练习题</h2></p><p><h3>1、表结构</h3></p><p>\`\`<code>plain
–1.学生表 Student(s_id,s_name,s_birth,s_sex) –学生编号,学生姓名, 出生年月,学生性别 –2.课程表 Course(c_id,c_name,t_id) – –课程编号, 课程名称, 教师编号 –3.教师表 Teacher(t_id,t_name) –教师编号,教师姓名 –4.成绩表 Score(s_id,c_id,s_score) –学生编号,课程编号,分数
</code>\`<code></p><p><h3>2、测试数据</h3></p><p></code>\`<code>sql
--建表--学生表CREATE TABLE </code>Student<code>(    </code>s_id<code> VARCHAR(20),    </code>s_name<code> VARCHAR(20) NOT NULL DEFAULT '',    </code>s_birth<code> VARCHAR(20) NOT NULL DEFAULT '',    </code>s_sex<code> VARCHAR(10) NOT NULL DEFAULT '',    PRIMARY KEY(</code>s_id<code>));--课程表CREATE TABLE </code>Course<code>(    </code>c_id<code>  VARCHAR(20),    </code>c_name<code> VARCHAR(20) NOT NULL DEFAULT '',    </code>t_id<code> VARCHAR(20) NOT NULL,    PRIMARY KEY(</code>c_id<code>));--教师表CREATE TABLE </code>Teacher<code>(    </code>t_id<code> VARCHAR(20),    </code>t_name<code> VARCHAR(20) NOT NULL DEFAULT '',    PRIMARY KEY(</code>t_id<code>));--成绩表CREATE TABLE </code>Score<code>(    </code>s_id<code> VARCHAR(20),    </code>c_id<code>  VARCHAR(20),    </code>s_score<code> INT(3),    PRIMARY KEY(</code>s_id<code>,</code>c_id<code>));--插入学生表测试数据insert into Student values('01' , '赵雷' , '1990-01-01' , '男');insert into Student values('02' , '钱电' , '1990-12-21' , '男');insert into Student values('03' , '孙风' , '1990-05-20' , '男');insert into Student values('04' , '李云' , '1990-08-06' , '男');insert into Student values('05' , '周梅' , '1991-12-01' , '女');insert into Student values('06' , '吴兰' , '1992-03-01' , '女');insert into Student values('07' , '郑竹' , '1989-07-01' , '女');insert into Student values('08' , '王菊' , '1990-01-20' , '女');--课程表测试数据insert into Course values('01' , '语文' , '02');insert into Course values('02' , '数学' , '01');insert into Course values('03' , '英语' , '03');--教师表测试数据insert into Teacher values('01' , '张三');insert into Teacher values('02' , '李四');insert into Teacher values('03' , '王五');--成绩表测试数据insert into Score values('01' , '01' , 80);insert into Score values('01' , '02' , 90);insert into Score values('01' , '03' , 99);insert into Score values('02' , '01' , 70);insert into Score values('02' , '02' , 60);insert into Score values('02' , '03' , 80);insert into Score values('03' , '01' , 80);insert into Score values('03' , '02' , 80);insert into Score values('03' , '03' , 80);insert into Score values('04' , '01' , 50);insert into Score values('04' , '02' , 30);insert into Score values('04' , '03' , 20);insert into Score values('05' , '01' , 76);insert into Score values('05' , '02' , 87);insert into Score values('06' , '01' , 31);insert into Score values('06' , '03' , 34);insert into Score values('07' , '02' , 89);insert into Score values('07' , '03' , 98);
</code>\`<code></p><p><h3>3、测试题</h3></p><p></code>\`<code>sql
-- 1、查询"01"课程比"02"课程成绩高的学生的信息及课程分数  select a.* ,b.s_score as 01_score,c.s_score as 02_score from     student a     join score b on a.s_id=b.s_id and b.c_id='01'    left join score c on a.s_id=c.s_id and c.c_id='02' or c.c_id = NULL where b.s_score>c.s_score-- 2、查询"01"课程比"02"课程成绩低的学生的信息及课程分数 select a.* ,b.s_score as 01_score,c.s_score as 02_score from     student a left join score b on a.s_id=b.s_id and b.c_id='01' or b.c_id=NULL      join score c on a.s_id=c.s_id and c.c_id='02' where b.s_score=60; -- 4、查询平均成绩小于60分的同学的学生编号和学生姓名和平均成绩        -- (包括有成绩的和无成绩的) select b.s_id,b.s_name,ROUND(AVG(a.s_score),2) as avg_score from     student b     left join score a on b.s_id = a.s_id    GROUP BY b.s_id,b.s_name HAVING ROUND(AVG(a.s_score),2)<60    unionselect a.s_id,a.s_name,0 as avg_score from     student a     where a.s_id not in (                select distinct s_id from score);-- 5、查询所有同学的学生编号、学生姓名、选课总数、所有课程的总成绩select a.s_id,a.s_name,count(b.c_id) as sum_course,sum(b.s_score) as sum_score from     student a     left join score b on a.s_id=b.s_id    GROUP BY a.s_id,a.s_name;-- 6、查询"李"姓老师的数量 select count(t_id) from teacher where t_name like '李%';-- 7、查询学过"张三"老师授课的同学的信息 select a.* from     student a     join score b on a.s_id=b.s_id where b.c_id in(        select c_id from course where t_id =(            select t_id from teacher where t_name = '张三'));-- 8、查询没学过"张三"老师授课的同学的信息 select * from     student c     where c.s_id not in(        select a.s_id from student a join score b on a.s_id=b.s_id where b.c_id in(            select c_id from course where t_id =(                select t_id from teacher where t_name = '张三')));-- 9、查询学过编号为"01"并且也学过编号为"02"的课程的同学的信息 select a.* from     student a,score b,score c     where a.s_id = b.s_id  and a.s_id = c.s_id and b.c_id='01' and c.c_id='02'; -- 10、查询学过编号为"01"但是没有学过编号为"02"的课程的同学的信息select a.* from     student a     where a.s_id in (select s_id from score where c_id='01' ) and a.s_id not in(select s_id from score where c_id='02')-- 11、查询没有学全所有课程的同学的信息 select s.* from     student s where s.s_id in(        select s_id from score where s_id not in(            select a.s_id from score a                 join score b on a.s_id = b.s_id and b.c_id='02'  `,
    author: defaultAuthor,
    readTime: '38 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "MySQL Read-Write Splitting",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-08-03-mysql',
    date: 'August 3, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-08-03-mysql',
    content: `<p><h2>MySQL读写分离</h2></p><p><h3>1、读写分离的介绍</h3></p><p><img src="/images/blog/%E8%AF%BB%E5%86%99%E5%88%86%E7%A6%BB.jpg" alt="illustration" class="my-4" /></p><p>​ MySQL读写分离基本原理是让master数据库处理写操作-slave数据库处理读操作。master将写操作的变更同步到各个slave节点。</p><p>​ MySQL读写分离能提高系统性能的原因在于：</p><p>​ 1、物理服务器增加-机器处理能力提升。拿硬件换性能。</p><p>​ 2、主从只负责各自的读和写-极大程度缓解X锁 (排它锁) 和S锁 (共享锁) 争用。</p><p>​ 3、slave可以配置myiasm引擎-提升查询性能以及节约系统开销。</p><p>​ 4、master直接写是并发的-slave通过主库发送来的binlog恢复数据是异步。</p><p>​ 5、slave可以单独设置一些参数来提升其读的性能。</p><p>​ 6、增加冗余-提高可用性。</p><p><h3>2、读写分离的配置</h3></p><p>##### 1、硬件配置</p><p>\`\`<code>plain
master 192.168.85.11slave  192.168.85.12proxy  192-168.85.14
</code>\`<code></p><p>##### 2、首先在master和slave上配置主从复制</p><p>##### 3、进行proxy的相关配置</p><p></code>\`<code>shell
#1、下载mysql-proxyhttps://downloads.mysql.com/archives/proxy/#downloads#2、上传软件到proxy的机器直接通过xftp进行上传#3、解压安装包tar -zxvf mysql-proxy-0.8.5-linux-glibc2.3-x86-64bit.tar.gz#4、修改解压后的目录mv mysql-proxy-0.8.5-linux-glibc2.3-x86-64bit mysql-proxy#5、进入mysql-proxy的目录cd mysql-proxy#6、创建目录mkdir confmkdir logs#7、添加环境变量#打开/etc/profile文件vi /etc/profile#在文件的最后面添加一下命令export PATH=\$PATH:/root/mysql-proxy/bin#8、执行命令让环境变量生效source /etc/profile#9、进入conf目录-创建文件并添加一下内容vi mysql-proxy.conf添加内容[mysql-proxy]user=rootproxy-address=192.168.85.14:4040proxy-backend-addresses=192.168.85.11:3306proxy-read-only-backend-addresses=192.168.85.12:3306proxy-lua-script=/root/mysql-proxy/share/doc/mysql-proxy/rw-splitting.lualog-file=/root/mysql-proxy/logs/mysql-proxy.loglog-level=debugdaemon=true#10、开启mysql-proxymysql-proxy --defaults-file=/root/mysql-proxy/conf/mysql-proxy.conf#11、查看是否安装成功-打开日志文件cd /root/mysql-proxy/logstail -100 mysql-proxy.log#内容如下：表示安装成功2019-10-11 21:49:41: (debug) max open file-descriptors = 10242019-10-11 21:49:41: (message) proxy listening on port 192.168.85.14:40402019-10-11 21:49:41: (message) added read/write backend: 192.168.85.11:33062019-10-11 21:49:41: (message) added read-only backend: 192.168.85.12:33062019-10-11 21:49:41: (debug) now running as user: root (0/0)
</code>\`<code></p><p>##### 4、进行连接</p><p></code>\`<code>shell
#mysql的命令行会出现无法连接的情况-所以建议使用客户端mysql -uroot -p123 -h192.168.85.14 -P 4040
</code>\`\`</p>`,
    author: defaultAuthor,
    readTime: '5 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "Java Exceptions and Common Classes",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-08-03',
    date: 'August 3, 2020',
    category: 'Backend',
    tags: ["Java SE"],
    slug: '2020-08-03',
    content: `<p>\`\`<code>java
/*throws:声明异常* 在异常情况出现的时候-可以使用try...catch...finally的方式对异常进行处理-除此之外-可以将异常向外跑出-由外部的进行处理*   1、在方法调用过程中-可以存在N多个方法之间的调用-此时假如每个方法中都包含了异常情况*       那么就需要在每个方法中都进行try。。catch-另外一种比较简单的方式-就是在方法的最外层调用处理一次即可*       使用throws的方法-对所有执行过程中的所有方法出现的异常进行统一集中处理*   2、如何判断是使用throws还是使用try...catch..*       最稳妥的方式是在每个方法中都进行异常的处理*       偷懒的方式是判断在整个调用的过程中-外层的调用方法是否有对异常的处理-如果有-直接使用throws,如果没有*           那么就要使用try...catch...* throw：抛出异常** */
</code>\`<code></p><p><img src="/images/blog/image-20200513140433429.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140502888.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140553620.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140731558.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140744790.png" alt="illustration" class="my-4" /></p><p>###### 常用类</p><p><img src="/images/blog/image-20200513140825045.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140834429.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140904488.png" alt="illustration" class="my-4" /></p><p>##### String</p><p></code>\`<code>java
/** 注意：常量池在1.7之后放置在了堆空间之中*       字符串的使用：*           1、创建*               String str = "abc";*               String str2 = new String("abc");*               两种方式都可以用-只不过第一种使用比较多*           2、字符串的本质*               字符串的本质是字符数组或者叫做字符序列*               String类使用final修饰-不可以被继承*               使用equals方法比较的是字符数组的每一个位置的值*               String是一个不可变对象* */
</code>\`<code></p><p><img src="/images/blog/image-20200513140925492.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513140955701.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141008463.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141134567.png" alt="illustration" class="my-4" /></p><p></code>\`<code>java
/** 可变字符串*   StringBuffer：线程安全-效率低*   StringBuilder: 线程不安全-效率高* */
</code>\`\`</p><p><img src="/images/blog/image-20200513141153565.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141202381.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141242100.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141249790.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141258922.png" alt="illustration" class="my-4" /></p><p>##### 时间</p><p><img src="/images/blog/image-20200513141313248.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141321073.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141328008.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141333994.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141353294.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200513141358822.png" alt="illustration" class="my-4" /></p>`,
    author: defaultAuthor,
    readTime: '7 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Java Collections Framework Guide",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-08-03',
    date: 'August 3, 2020',
    category: 'Backend',
    tags: ["Java SE"],
    slug: '2020-08-03',
    content: `<p>##### 集合</p><p>\`\`<code>java
/<strong> java集合框架：*   Collection：存放的是单一值*       特点：*           1、可以存放不同类型的数据-而数组只能存放固定类型的数据*           2、当使用arraylist子类实现的时候-初始化的长度是10-当长度不够的时候会自动进行扩容操作*       api方法：*           增加数据的方法*           add：要求必须传入的参数是Object对象-因此当写入基本数据类型的时候-包含了自动拆箱和自动装箱的过程*           addAll:添加另一个集合的元素到此集合中</strong>           删除数据的方法*           clear:只是清空集合中的元素-但是此集合对象并没有被回收*           remove:删除指定元素*           removeAll：删除集合元素<strong>           查询数据的方法*           contains:判断集合中是否包含指定的元素值*           containsAll:判断此集合中是否包含另一个集合*           isEmpty:判断集合是否等于空*           retainAll:若集合中拥有另一个集合的所有元素-返回true-否则返回false*           size:返回当前集合的大小</strong>           //集合转数组的操作*           toArray:将集合转换成数组* */
</code>\`<code></p><p><img src="/images/blog/image-20200514121720326.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514121734482.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514121747635.png" alt="illustration" class="my-4" /></p><p>##### List</p><p></code>\`<code>java
/<strong> java集合框架：*   List：存放的是单一值*       特点：*           1、可以存放不同类型的数据-而数组只能存放固定类型的数据*           2、当使用arraylist子类实现的时候-初始化的长度是10-当长度不够的时候会自动进行扩容操作*       api方法：*           增加数据的方法*           add：要求必须传入的参数是Object对象-因此当写入基本数据类型的时候-包含了自动拆箱和自动装箱的过程*           addAll:添加另一个集合的元素到此集合中</strong>           删除数据的方法*           clear:只是清空集合中的元素-但是此集合对象并没有被回收*           remove:删除指定元素*           removeAll：删除集合元素<strong>           查询数据的方法*           contains:判断集合中是否包含指定的元素值*           containsAll:判断此集合中是否包含另一个集合*           isEmpty:判断集合是否等于空*           retainAll:若集合中拥有另一个集合的所有元素-返回true-否则返回false*           size:返回当前集合的大小</strong>           //集合转数组的操作*           toArray:将集合转换成数组* */
</code>\`<code></p><p><img src="/images/blog/image-20200514121809284.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514121818097.png" alt="illustration" class="my-4" /></p><p>###### 迭代器</p><p></code>\`<code>java
/<strong> 在java代码中包含三种循环的方式*   do...while*   while*   for* 还有一种增强for循环的方式-可以简化循环的编写</strong>*   所有的集合类都默认实现了Iterable的接口-实现此接口意味着具备了增强for循环的能力-也就是for-each*      增强for循环本质上使用的也是iterator的功能*      方法：*               iterator()*               foreach()*   在iterator的方法中-要求返回一个Iterator的接口子类实例对象*       此接口中包含了*               hasNext()*               next()**   在使用iterator进行迭代的过程中如果删除其中的某个元素会报错-并发操作异常-因此*       如果遍历的同时需要修改元素-建议使用listIterator（）-*   ListIterator迭代器提供了向前和向后两种遍历的方式*       始终是通过cursor和lastret的指针来获取元素值及向下的遍历索引*       当使用向前遍历的时候必须要保证指针在迭代器的结果-否则无法获取结果值* */
</code>\`<code></p><p><img src="/images/blog/image-20200514121910889.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514121922127.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514122001163.png" alt="illustration" class="my-4" /></p><p>###### LinkedList</p><p><img src="/images/blog/image-20200514122038056.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514122050646.png" alt="illustration" class="my-4" /></p><p>###### Vector</p><p></code>\`<code>java
/** *      1、Vector也是List接口的一个子类实现 *      2、Vector跟ArrayList一样-底层都是使用数组进行实现的 *      3、面试经常问区别： *          （1）ArrayList是线程不安全的-效率高-Vector是线程安全的效率低 *          （2）ArrayList在进行扩容的时候-是扩容1.5倍-Vector扩容的时候扩容原来的2倍 *
</code>\`<code></p><p>##### Set</p><p></code>\`<code>java
/**   1、set中存放的是无序-唯一的数据*   2、set不可以通过下标获取对应位置的元素的值-因为无序的特点*   3、使用treeset底层的实现是treemap,利用红黑树来进行实现*   4、设置元素的时候-如果是自定义对象-会查找对象中的equals和hashcode的方法-如果没有-比较的是地址*   5、树中的元素是要默认进行排序操作的-如果是基本数据类型-自动比较-如果是引用类型的话-需要自定义比较器*       比较器分类：*         内部比较器*               定义在元素的类中-通过实现comparable接口来进行实现*         外部比较器*               定义在当前类中-通过实现comparator接口来实现-但是要将该比较器传递到集合中*         注意：外部比较器可以定义成一个工具类-此时所有需要比较的规则如果一致的话-可以复用-而*               内部比较器只有在存储当前对象的时候才可以使用*               如果两者同时存在-使用外部比较器*               当使用比较器的时候-不会调用equals方法* */
</code>\`<code></p><p><img src="/images/blog/image-20200514122123267.png" alt="illustration" class="my-4" /></p><p>###### HashSet</p><p><img src="/images/blog/image-20200514122143284.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514122235681.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514122252795.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514122334514.png" alt="illustration" class="my-4" /></p><p>###### TreeSet</p><p><img src="/images/blog/image-20200514122417659.png" alt="illustration" class="my-4" /></p><p>###### 比较器</p><p></code>\`<code>java
/***         内部比较器*               定义在元素的类中-通过实现comparable接口来进行实现*         外部比较器*               定义在当前类中-通过实现comparator接口来实现-但是要将该比较器传递到集合中*         注意：外部比较器可以定义成一个工具类-此时所有需要比较的规则如果一致的话-可以复用-而*               内部比较器只有在存储当前对象的时候才可以使用*               如果两者同时存在-使用外部比较器*               当使用比较器的时候-不会调用equals方法* */
</code>\`<code></p><p><img src="/images/blog/image-20200514122527240.png" alt="illustration" class="my-4" /></p><p><img src="/images/blog/image-20200514122557122.png" alt=`,
    author: defaultAuthor,
    readTime: '15 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Spring AOP: Declarative Transactions",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-08-04-spring-aop',
    date: 'August 4, 2020',
    category: 'Spring',
    tags: ["Framework","Spring","AOP"],
    slug: '2020-08-04-spring-aop',
    content: `<p><h1>Spring AOP的应用配置</h1></p><p><h3>1、Spring JdbcTemplate</h3></p><p>​ 在spring中为了更加方便的操作JDBC-在JDBC的基础之上定义了一个抽象层-此设计的目的是为不同类型的JDBC操作提供模板方法-每个模板方法都能控制整个过程-并允许覆盖过程中的特定任务-通过这种方式-可以尽可能保留灵活性-将数据库存取的工作量讲到最低。</p><p>##### 1、配置并测试数据源</p><p>pom.xml</p><p>\`\`<code>xml
    4.0.0    com.oi    spring_demo    1.0-SNAPSHOT                                org.springframework            spring-context            5.2.3.RELEASE                                    com.alibaba            druid            1.1.21                                    mysql            mysql-connector-java            5.1.47                                    cglib            cglib            3.3.0                                    org.aspectj            aspectjweaver            1.9.5                                    aopalliance            aopalliance            1.0                                    org.springframework            spring-aspects            5.2.3.RELEASE
</code>\`<code></p><p>dbconfig.properties</p><p></code>\`<code>properties
jdbc.username=root123password=123456url=jdbc:mysql://localhost:3306/demodriverClassName=com.mysql.jdbc.Driver
</code>\`<code></p><p>applicationContext.xml</p><p>MyTest.java</p><p></code>\`<code>java
import com.alibaba.druid.pool.DruidDataSource;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;import java.sql.SQLException;public class MyTest {    public static void main(String[] args) throws SQLException {        ApplicationContext context = new ClassPathXmlApplicationContext("jdbcTemplate.xml");        DruidDataSource dataSource = context.getBean("dataSource", DruidDataSource.class);        System.out.println(dataSource);        System.out.println(dataSource.getConnection());    }}
</code>\`<code></p><p>##### 2、给spring容器添加JdbcTemplate</p><p>​ spring容器提供了一个JdbcTemplate类-用来方便操作数据库。</p><p>1、添加pom依赖</p><p>pom.xml</p><p></code>\`<code>xml
    org.springframework    spring-orm    5.2.3.RELEASE
</code>\`<code></p><p>jdbcTemplate.xml</p><p>MyTest.java</p><p></code>\`<code>java
import com.alibaba.druid.pool.DruidDataSource;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;import org.springframework.jdbc.core.JdbcTemplate;import java.sql.SQLException;public class MyTest {    public static void main(String[] args) throws SQLException {        ApplicationContext context = new ClassPathXmlApplicationContext("jdbcTemplate.xml");        JdbcTemplate jdbcTemplate = context.getBean("jdbcTemplate", JdbcTemplate.class);        System.out.println(jdbcTemplate);    }}
</code>\`<code></p><p>##### 3、插入数据</p><p>MyTest.java</p><p></code>\`<code>java
import com.alibaba.druid.pool.DruidDataSource;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;import org.springframework.jdbc.core.JdbcTemplate;import java.sql.SQLException;public class MyTest {    public static void main(String[] args) throws SQLException {        ApplicationContext context = new ClassPathXmlApplicationContext("jdbcTemplate.xml");        JdbcTemplate jdbcTemplate = context.getBean("jdbcTemplate", JdbcTemplate.class);        String sql = "insert into emp(empno,ename) values(?,?)";        int result = jdbcTemplate.update(sql, 1111, "zhangsan");        System.out.println(result);    }}
</code>\`<code></p><p>##### 4、批量插入数据</p><p>MyTest.java</p><p></code>\`<code>java
import com.alibaba.druid.pool.DruidDataSource;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;import org.springframework.jdbc.core.JdbcTemplate;import java.sql.SQLException;import java.util.ArrayList;import java.util.List;public class MyTest {    public static void main(String[] args) throws SQLException {        ApplicationContext context = new ClassPathXmlApplicationContext("jdbcTemplate.xml");        JdbcTemplate jdbcTemplate = context.getBean("jdbcTemplate", JdbcTemplate.class);        String sql = "insert into emp(empno,ename) values(?,?)";        List list = new ArrayList();        list.add(new Object[]{1,"zhangsan1"});        list.add(new Object[]{2,"zhangsan2"});        list.add(new Object[]{3,"zhangsan3"});        int[] result = jdbcTemplate.batchUpdate(sql, list);        for (int i : result) {            System.out.println(i);        }    }}
</code>\`<code></p><p>##### 5、查询某个值-并以对象的方式返回</p><p>MyTest.java</p><p></code>\`<code>java
import com.oi.bean.Emp;import org.springframework.context.ApplicationContext;import org.springframework.context.support.ClassPathXmlApplicationContext;import org.springframework.jdbc.core.BeanPropertyRowMapper;import org.springframework.jdbc.core.JdbcTemplate;import java.sql.SQLException;public class MyTest {    public static void main(String[] args) throws SQLExc`,
    author: defaultAuthor,
    readTime: '72 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "Spring MVC Introduction and Usage",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog3.jpg',
    url: '/blog/2020-08-04-spring-mvc',
    date: 'August 4, 2020',
    category: 'Spring',
    tags: ["Spring","Spring MVC"],
    slug: '2020-08-04-spring-mvc',
    content: `<p><h1>Spring MVC介绍及使用</h1></p><p><h3>1、什么是MVC？</h3></p><p>​ MVC是模型(Model)、视图(View)、控制器(Controller)的简写-是一种软件设计规范。就是将业务逻辑、数据、显示分离的方法来组织代码。MVC主要作用是<strong>降低了视图与业务逻辑间的双向偶合</strong>。MVC不是一种设计模式-<strong>MVC是一种架构模式</strong>。当然不同的MVC存在差异。</p><p>​ <strong>Model（模型）：</strong>数据模型-提供要展示的数据-因此包含数据和行为-可以认为是领域模型或JavaBean组件（包含数据和行为）-不过现在一般都分离开来：Value Object（数据Dao） 和 服务层（行为Service）。也就是模型提供了模型数据查询和模型数据的状态更新等功能-包括数据和业务。</p><p>​ <strong>View（视图）：</strong>负责进行模型的展示-一般就是我们见到的用户界面-客户想看到的东西。</p><p>​ <strong>Controller（控制器）：</strong>接收用户请求-委托给模型进行处理（状态改变）-处理完毕后把返回的模型数据返回给视图-由视图负责展示。 也就是说控制器做了个调度员的工作。</p><p>​ 其实在最早期的时候还有model1和model2的设计模型</p><p><strong>最典型的MVC就是JSP + servlet + javabean的模式。</strong></p><p>!\<a href="Spring MVC的介绍及使用/mvc.png">mvc\</a></p><p>代码展示：</p><p>HelloServlet.java</p><p>\`\`<code>java
package com.oi.controller;import javax.servlet.ServletException;import javax.servlet.http.HttpServlet;import javax.servlet.http.HttpServletRequest;import javax.servlet.http.HttpServletResponse;import java.io.IOException;public class HelloServlet extends HttpServlet {    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {        String method = request.getParameter("method");        if (method.equals("add")){            request.getSession().setAttribute("msg","add");        }else if(method.equals("sub")){            request.getSession().setAttribute("msg","sub");        }        request.getRequestDispatcher("index.jsp").forward(request,response);    }    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {        this.doPost(request, response);    }}
</code>\`<code></p><p>web.xml</p><p></code>\`<code>xml
            HelloServlet        com.oi.controller.HelloServlet                HelloServlet        /user
</code>\`<code></p><p>index.jsp</p><p></code>\`<code>
<%@ page contentType="text/html;charset=UTF-8" language="java" %>      \$Title\$      \${msg}
</code>\`<code></p><p>输入网址：<a href="http://localhost:8080/servlet_demo_war_exploded/user?method=add">http://localhost:8080/servlet_demo_war_exploded/user?method=add</a></p><p><h3>2、SpringMVC</h3></p><p>##### 1、SpringMVC的介绍</p><p></code>\`<code>plain
Spring Web MVC is the original web framework built on the Servlet API and has been included in the Spring Framework from the very beginning. The formal name, “Spring Web MVC,” comes from the name of its source module (spring-webmvc), but it is more commonly known as “Spring MVC”.Spring Web MVC是构建在Servlet API上的原始Web框架-从一开始就包含在Spring Framework中。 正式名称 “Spring Web MVC,” 来自其源模块(spring-webmvc)的名称-但它通常被称为“Spring MVC”。
</code>\`<code></p><p>​ 简而言之-springMVC是Spring框架的一部分-是基于java实现的一个轻量级web框架。</p><p>​ 学习SpringMVC框架最核心的就是DispatcherServlet的设计-掌握好DispatcherServlet是掌握SpringMVC的核心关键。</p><p>##### 2、SpringMVC的优点</p><p>​ 1.清晰的角色划分：控制器(controller)、验证器(validator)、命令对象(command obect)、表单对象(form object)、模型对象(model object)、Servlet分发器(DispatcherServlet)、处理器映射(handler mapping)、试图解析器(view resoler)等等。每一个角色都可以由一个专门的对象来实现。</p><p>​ 2.强大而直接的配置方式：将框架类和应用程序类都能作为JavaBean配置-支持跨多个context的引用-例如-在web控制器中对业务对象和验证器validator)的引用。  
​ 3.可适配、非侵入：可以根据不同的应用场景-选择何事的控制器子类(simple型、command型、from型、wizard型、multi-action型或者自定义)-而不是一个单一控制器(比如Action/ActionForm)继承。  
​ 4.可重用的业务代码：可以使用现有的业务对象作为命令或表单对象-而不需要去扩展某个特定框架的基类。  
​ 5.可定制的绑定(binding)和验证(validation)：比如将类型不匹配作为应用级的验证错误-这可以保证错误的值。再比如本地化的日期和数字绑定等等。在其他某些框架中-你只能使用字符串表单对象-需要手动解析它并转换到业务对象。  
​ 6.可定制的handler mapping和view resolution：Spring提供从最简单的URL映射-到复杂的、专用的定制策略。与某些web MVC框架强制开发人员使用单一特定技术相比-Spring显得更加灵活。  
​ 7.灵活的model转换：在Springweb框架中-使用基于Map的键/值对来达到轻易的与各种视图技术集成。  
​ 8.可定制的本地化和主题(theme)解析：支持在JSP中可选择地使用Spring标签库、支持JSTL、支持Velocity(不需要额外的中间层)等等。  
​ 9.简单而强大的JSP标签库(Spring Tag Library)：支持包括诸如数据绑定和主题(theme)之类的许多功能。他提供在标记方面的最大灵活性。  
​ 10.JSP表单标签库：在Spring2.0中引入的表单标签库-使用在JSP编写表单更加容易。  
​ 11.Spring Bean的生命周期：可以被限制在当前的HTTp Request或者HTTp Session。准确的说-这并非Spring MVC框架本身特性-而应归属于Spring MVC使用的WebApplicationContext容器。</p><p>##### 3、SpringMVC的实现原理</p><p>​ springmvc的mvc模式：</p><p>!\<a href="Spring MVC的介绍及使用/springmvc.png">\</a></p><p>SpringMVC的具体执行流程：</p><p>​ 当发起请求时被前置的控制器拦截到请求-根据请求参数生成代理请求-找到请求对应的实际控制器-控制器处理请求-创建数据模型-访问数据库-将模型响应给中心控制器-控制器使用模型与视图渲染视图结果-将结果返回给中心控制器-再将结果返回给请求者。</p><p>!\<a href="Spring MVC的介绍及使用/springmvc运行流程.jpg">\</a></p><p></code>\`<code>plain
1、DispatcherServlet表示前置控制器-是整个SpringMVC的控制中心。用户发出请求-DispatcherServlet接收请求并拦截请求。2、HandlerMapping为处理器映射。DispatcherServlet调用HandlerMapping,HandlerMapping根据请求url查找Handler。3、返回处理器执行链-根据url查找控制器-并且将解析后的信息传递给DispatcherServlet4、HandlerAdapter表示处理器适配器-其按照特定的规则去执行Handler。5、执行handler找到具体的处理器6、Controller将具体的执行信息返回给HandlerAdapter,如ModelAndView。7、HandlerAdapter将视图逻辑名或模型传递给DispatcherServlet。8、DispatcherServlet调用视图解析器(ViewResolver)来解析HandlerAdapter传递的逻辑视图名。9、视图解析器将解析的逻辑视图名传给DispatcherServlet。10、DispatcherServlet根据视图解析器解析的视图结果-调用具体的视图-进行试图渲染11、将响应数据返回给客户端
</code>\`<code></p><p><h3>3、基于XML的Hello_SpringMVC</h3></p><p>1、添加pom依赖</p><p></code>\`<code>xml
                org.springframework        spring-context      `,
    author: defaultAuthor,
    readTime: '44 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "Advanced Spring MVC Usage",
    excerpt: "Advanced Spring MVC features including interceptors, exception handling, file upload, async processing, and RESTful best practices.",
    image: '/img/blog4.jpg',
    url: '/blog/2020-08-04-spring-mvc-1',
    date: 'August 4, 2020',
    category: 'Spring',
    tags: ["Spring","Spring MVC"],
    slug: '2020-08-04-spring-mvc-1',
    content: `<p><h1>Spring MVC的进阶使用-1</h1></p><p><h3>（1）SpringMVC的请求处理</h3></p><p>##### 1、SpringMVC对请求参数的处理</p><p>​ 在之前的servlet中我们可以通过request.getParameter()来获取请求中的参数-但是在我们编写的SpringMVC的应用程序中-在具体请求的方法中并不包含request参数-那么我们应该如何获取请求中的参数呢？</p><p>​ 需要使用以下几个注解：</p><p>​ @RequestParam：获取请求的参数</p><p>​ @RequestHeader：获取请求头信息</p><p>​ @CookieValue：获取cookie中的值</p><p>@RequestParam的基本使用</p><p>\`\`<code>java
package com.oi.controller;import org.springframework.stereotype.Controller;import org.springframework.web.bind.annotation.RequestMapping;import org.springframework.web.bind.annotation.RequestParam;@Controllerpublic class RequestController {    /**     * 如何获取SpringMVC中请求中的信息     *  默认情况下-可以直接在方法的参数中填写跟请求一样的名称-此时会默认接受参数     *      如果有值-直接赋值-如果没有-那么直接给空值     *     * @RequestParam:获取请求中的参数值,使用此注解之后-参数的名称不需要跟请求的名称一致-但是必须要写     *      public String request(@RequestParam("user") String username){     *     *      此注解还包含三个参数：     *      value:表示要获取的参数值     *      required：表示此参数是否必须-默认是true-如果不写参数那么会报错-如果值为false-那么不写参数不会有任何错误     *      defaultValue:如果在使用的时候没有传递参数-那么定义默认值即可     *     *     * @param username     * @return     */    @RequestMapping("/request")    public String request(@RequestParam(value = "user",required = false,defaultValue = "hehe") String username){        System.out.println(username);        return "success";    }}
</code>\`<code></p><p>@RequestHeader的基本使用：</p><p></code>\`<code>java
package com.oi.controller;import org.springframework.stereotype.Controller;import org.springframework.web.bind.annotation.RequestHeader;import org.springframework.web.bind.annotation.RequestMapping;import org.springframework.web.bind.annotation.RequestParam;import sun.management.resources.agent;@Controllerpublic class RequestController {    /**     * 如果需要获取请求头信息该如何处理呢？     *  可以使用@RequestHeader注解-     *      public String header(@RequestHeader("User-Agent") String agent){     *      相当于  request.getHeader("User-Agent")     *     *      如果要获取请求头中没有的信息-那么此时会报错-同样-此注解中也包含三个参数,跟@RequestParam一样     *          value     *          required     *          defalutValue     * @param agent     * @return     */    @RequestMapping("/header")    public String header(@RequestHeader("User-Agent") String agent){        System.out.println(agent);        return "success";    }}
</code>\`<code></p><p>@CookieValue的基本使用</p><p></code>\`<code>java
package com.oi.controller;import org.springframework.stereotype.Controller;import org.springframework.web.bind.annotation.CookieValue;import org.springframework.web.bind.annotation.RequestHeader;import org.springframework.web.bind.annotation.RequestMapping;import org.springframework.web.bind.annotation.RequestParam;import sun.management.resources.agent;@Controllerpublic class RequestController {    /**     * 如果需要获取cookie信息该如何处理呢？     *  可以使用@CookieValue注解-     *      public String cookie(@CookieValue("JSESSIONID") String id){     *      相当于     *      Cookie[] cookies = request.getCookies();     *      for(Cookie cookie : cookies){     *          cookie.getValue();     *      }     *      如果要获取cookie中没有的信息-那么此时会报错-同样-此注解中也包含三个参数,跟@RequestParam一样     *          value     *          required     *          defalutValue     * @param id     * @return     */    @RequestMapping("/cookie")    public String cookie(@CookieValue("JSESSIONID") String id){        System.out.println(id);        return "success";    }}
</code>\`<code></p><p>​ 如果请求中传递的是某一个对象的各个属性值-此时如何在控制器的方法中获取对象的各个属性值呢？</p><p>​ 在SpringMVC的控制中-能直接完成对象的属性赋值操作-不需要人为干预。</p><p>User.java</p><p></code>\`<code>java
package com.oi.bean;import java.util.Date;public class User {    private Integer id;    private String name;    private Integer age;    private Date date;    private Address address;    public Integer getId() {        return id;    }    public void setId(Integer id) {        this.id = id;    }    public String getName() {        return name;    }    public void setName(String name) {        this.name = name;    }    public Integer getAge() {        return age;    }    public void setAge(Integer age) {        this.age = age;    }    public Date getDate() {        return date;    }    public void setDate(Date date) {        this.date = date;    }    public Address getAddress() {        return address;    }    public void setAddress(Address address) {        this.address = address;    }    @Override    public String toString() {        return "User{" +                "id=" + id +                ", name='" + name + '\'' +                ", age=" + age +                ", date=" + date +                ", address=" + address +                '}';    }}
</code>\`<code></p><p>Address.java</p><p></code>\`<code>java
package com.oi.bean;public class Address {    private String province;    private String city;    private String town;    public String getProvince() {        return province;    }    public void setProvince(String province) {        this.province = province;    }    public String getCity() {        return city;    }    public void setCity(String city) {        this.city = ci`,
    author: defaultAuthor,
    readTime: '81 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  },
  {
    title: "Dynamic Proxy: JDK vs CGLIB Implementation",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog5.jpg',
    url: '/blog/2020-08-04-jdkcglib',
    date: 'August 4, 2020',
    category: 'Backend',
    tags: ["Dynamic Proxy","CGLib","JDK"],
    slug: '2020-08-04-jdkcglib',
    content: `<p><h1>两种动态代理</h1></p><p><h3>1、jdk的动态代理</h3></p><p>​ 讲一下动态代理的实现原理-说明白原理的话肯定是要看源码了-不要慌-干就完了！！！</p><p>​ 其实在使用动态代理的时候最最核心的就是Proxy.newProxyInstance(loader, interfaces, h);废话不多说-直接干源码。</p><p><strong>动态代理的样例代码：</strong></p><p>Calculator.java</p><p>\`\`<code>java
package com.oi;public interface Calculator {    public int add(int i, int j);    public int sub(int i, int j);    public int mult(int i, int j);    public int div(int i, int j);}
</code>\`<code></p><p>MyCalculator.java</p><p></code>\`<code>java
package com.oi;public class MyCalculator implements Calculator {    public int add(int i, int j) {        int result = i + j;        return result;    }    public int sub(int i, int j) {        int result = i - j;        return result;    }    public int mult(int i, int j) {        int result = i * j;        return result;    }    public int div(int i, int j) {        int result = i / j;        return result;    }}
</code>\`<code></p><p>CalculatorProxy.java</p><p></code>\`<code>java
package com.oi;import java.lang.reflect.InvocationHandler;import java.lang.reflect.Method;import java.lang.reflect.Proxy;public class CalculatorProxy {    public static Calculator getProxy(final Calculator calculator){        ClassLoader loader = calculator.getClass().getClassLoader();        Class[] interfaces = calculator.getClass().getInterfaces();        InvocationHandler h = new InvocationHandler() {            public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {                Object result = null;                try {                    result = method.invoke(calculator, args);                } catch (Exception e) {                } finally {                }                return result;            }        };        Object proxy = Proxy.newProxyInstance(loader, interfaces, h);        return (Calculator) proxy;    }}
</code>\`<code></p><p>Test.java</p><p></code>\`<code>java
package com.oi;public class Test {    public static void main(String[] args) {        Calculator proxy = CalculatorProxy.getProxy(new MyCalculator());        proxy.add(1,1);        System.out.println(proxy.getClass());    }}
</code>\`<code></p><p><strong>动态代理的源码：</strong></p><p>Proxy.java的newProxyInstance方法：</p><p></code>\`<code>java
public static Object newProxyInstance(ClassLoader loader,                                          Class[] interfaces,                                          InvocationHandler h)        throws IllegalArgumentException    {    //判断InvocationHandler是否为空-若为空-抛出空指针异常        Objects.requireNonNull(h);        final Class[] intfs = interfaces.clone();        final SecurityManager sm = System.getSecurityManager();        if (sm != null) {            checkProxyAccess(Reflection.getCallerClass(), loader, intfs);        }        /*         * Look up or generate the designated proxy class.         * 生成接口的代理类的字节码文件         */        Class cl = getProxyClass0(loader, intfs);        /*         * Invoke its constructor with the designated invocation handler.         * 使用自定义的InvocationHandler作为参数-调用构造函数获取代理类对象实例         */        try {            if (sm != null) {                checkNewProxyPermission(Reflection.getCallerClass(), cl);            }			//获取代理对象的构造方法            final Constructor cons = cl.getConstructor(constructorParams);            final InvocationHandler ih = h;            if (!Modifier.isPublic(cl.getModifiers())) {                AccessController.doPrivileged(new PrivilegedAction() {                    public Void run() {                        cons.setAccessible(true);                        return null;                    }                });            }            //生成代理类的实例并把InvocationHandlerImpl的实例传给构造方法            return cons.newInstance(new Object[]{h});        } catch (IllegalAccessException|InstantiationException e) {            throw new InternalError(e.toString(), e);        } catch (InvocationTargetException e) {            Throwable t = e.getCause();            if (t instanceof RuntimeException) {                throw (RuntimeException) t;            } else {                throw new InternalError(t.toString(), t);            }        } catch (NoSuchMethodException e) {            throw new InternalError(e.toString(), e);        }    }
</code>\`<code></p><p>getProxyClass0(ClassLoader loader,Class<?>… interfaces)</p><p></code>\`<code>java
private static Class getProxyClass0(ClassLoader loader,                                       Class... interfaces) {    //限定代理的接口不能超过65535个    if (interfaces.length > 65535) {        throw new IllegalArgumentException("interface limit exceeded");    }    // If the proxy class defined by the given loader implementing    // the given interfaces exists, this will simply return the cached copy;    // otherwise, it will create the proxy class via the ProxyClassFactory    // 如果缓存中已经存在相应接口的代理类-直接返回-否则-使用ProxyClassFactory创建代理类    return proxyClassCache.get(loader, interfaces);}/** * a cache of proxy classes */private static final WeakCache[], Class>    proxyClassCache`,
    author: defaultAuthor,
    readTime: '123 min read',
    relatedPosts: ["2020-05-23-java","2020-06-13"],
  },
  {
    title: "Eureka Service Registry Deep Dive",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog6.jpg',
    url: '/blog/2020-08-13-eureka',
    date: 'August 13, 2020',
    category: 'Distributed Systems',
    tags: ["Spring Cloud","Framework","Microservices"],
    slug: '2020-08-13-eureka',
    content: `<p><h2>1 Eureka 单节点搭建</h2></p><p><li> pom.xml</li></p><p>    \`\`<code>sh
    	org.springframework.cloud	spring-cloud-starter-netflix-eureka-server有的教程中还引入spring-boot-starter-web-其实不用。因为上面的依赖已经包含了它。在pom中点此依赖进去-一共点4次spring-cloud-netflix-eureka-server-发现web的依赖。
    </code>\`<code></p><p><li> application.yml</li></p><p>    </code>\`<code>sh
    eureka:   client:    #是否将自己注册到Eureka Server,默认为true-由于当前就是server-故而设置成false-表明该服务不会向eureka注册自己的信息    register-with-eureka: false    #是否从eureka server获取注册信息-由于单节点-不需要同步其他节点数据-用false    fetch-registry: false    #设置服务注册中心的URL-用于client和server端交流    service-url:                            defaultZone: http://root:root@eureka-7901:7901/eureka/
    </code>\`<code></p><p><li> 代码</li></p><p>    </code>\`<code>sh
    启动类上添加此注解标识该服务为配置中心@EnableEurekaServer
    </code>\`<code></p><p><li> PS：Eureka会暴露一些端点。端点用于Eureka Client注册自身-获取注册表-发送心跳。</li>
<li> 简单看一下eureka server控制台-实例信息区-运行环境信息区-Eureka Server自身信息区。</li></p><p><h2>2 整体介绍</h2></p><p><li> 背景：在传统应用中-组件之间的调用-通过有规范的约束的接口来实现-从而实现不同模块间良好的协作。但是被拆分成微服务后-每个微服务实例的网络地址都可能动态变化-数量也会变化-使得原来硬编码的地址失去了作用。需要一个中心化的组件来进行服务的登记和管理。</li>
<li> 概念：实现服务治理-即管理所有的服务信息和状态。</li></p><p></code>\`<code>sh
注册中心相当于买票乘车-只看有没有票（有没有服务）-有就去买票（获取注册列表）-然后乘车（调用）。不必关心有多少火车在运行。
</code>\`<code></p><p><li> 注册中心好处：不用关心有多少提供方。</li>
<li> 注册中心有哪些:Eureka-Nacos-Consul-Zookeeper等。</li>
<li> 服务注册与发现包括两部分-一个是服务器端-另一个是客户端。</li></p><p>    Server是一个公共服务-为Client提供服务注册和发现的功能-维护注册到自身的Client的相关信息-同时提供接口给Client获取注册表中其他服务的信息-使得动态变化的Client能够进行服务间的相互调用。</p><p>    Client将自己的服务信息通过一定的方式登记到Server上-并在正常范围内维护自己信息一致性-方便其他服务发现自己-同时可以通过Server获取到自己依赖的其他服务信息-完成服务调用-还内置了负载均衡器-用来进行基本的负载均衡。</p><p><li> 我们课程的Spring Cloud是用Eureka作为服务注册中心。</li>
<li> Eureka：是一个RESTful风格的服务-是一个用于服务发现和注册的基础组件-是搭建Spring Cloud微服务的前提之一-它屏蔽了Server和client的交互细节-使得开发者将精力放到业务上。</li>
<li> serverA从serverB同步信息-则serverB是serverA的peer。</li>
<li> 上面例子中如果service-url为空-且register-with-eureka-fetch-registry为true-则会报错-Cannot execute request on any known server-因为server同时也是一个client-他会尝试注册自己-所以要有一个注册中心url去注册。</li>
<li>Netflix开源的组件。包括server和client两部分。</li></p><p>    </code>\`<code>sh
    https://github.com/Netflix/Eureka
    </code>\`<code></p><p><h2>3 注册中心和微服务间的关系</h2></p><p><img src="/images/blog/image-20200823173543002.png" alt="illustration" class="my-4" /></p><p><h3>11.3.1 client功能</h3></p><p><li> 注册：每个微服务启动时-将自己的网络地址等信息注册到注册中心-注册中心会存储（内存中）这些信息。</li>
<li> 获取服务注册表：服务消费者从注册中心-查询服务提供者的网络地址-并使用该地址调用服务提供者-为了避免每次都查注册表信息-所以client会定时去server拉取注册表信息到缓存到client本地。</li>
<li> 心跳：各个微服务与注册中心通过某种机制（心跳）通信-若注册中心长时间和服务间没有通信-就会注销该实例。</li>
<li> 调用：实际的服务调用-通过注册表-解析服务名和具体地址的对应关系-找到具体服务的地址-进行实际调用。</li></p><p><h3>11.3.2 server注册中心功能</h3></p><p><li> 服务注册表：记录各个微服务信息-例如服务名称-ip-端口等。</li></p><p>    注册表提供 查询API（查询可用的微服务实例）和管理API（用于服务的注册和注销）。</p><p><li> 服务注册与发现：注册：将微服务信息注册到注册中心。发现：查询可用微服务列表及其网络地址。</li>
<li> 服务检查：定时检测已注册的服务-如发现某实例长时间无法访问-就从注册表中移除。</li></p><p>组件：Eureka , Consul , ZooKeeper-nacos等。</p><p><h2>4 服务注册</h2></p><p>例子：api-listen-order</p><p><li> pom.xml</li></p><p></code>\`<code>sh
	org.springframework.cloud	spring-cloud-starter-netflix-eureka-client
</code>\`<code></p><p><li> application.yml</li></p><p></code>\`<code>sh
#注册中心eureka:   client:    #设置服务注册中心的URL    service-url:                            defaultZone: http://root:root@localhost:7900/eureka/
</code>\`<code></p><p>ps:不想注册-设置成false即可-实例演示结果：注册中心没有实例信息。找控制台204信息也没有找到。</p><p></code>\`<code>sh
spring:   cloud:    service-registry:      auto-registration:        enabled: false
</code>\`<code></p><p>注册成功：</p><p></code>\`<code>sh
DiscoveryClient_API-LISTEN-ORDER/api-listen-order:30.136.133.9:port - registration status: 204
</code>\`<code></p><p>后面源码讲手动注册。</p><p>PS:</p><p>Eureka Server与Eureka Client之间的联系主要通过心跳的方式实现。心跳(Heartbeat)即Eureka Client定时向Eureka Server汇报本服务实例当前的状态-维护本服务实例在注册表中租约的有效性。</p><p>Eureka Client将定时从Eureka Server中拉取注册表中的信息-并将这些信息缓存到本地-用于服务发现。</p><p><h2>5 Eureka高可用</h2></p><p>高可用：可以通过运行多个Eureka server实例并相互注册的方式实现。Server节点之间会彼此增量地同步信息-从而确保节点中数据一致。</p><p><li> 注册中心改造</li></p><p>application.yml</p><p>参考：#高可用2个节点的yml</p><p></code>\`<code>sh
#高可用2个节点#应用名称及验证账号spring:   application:     name: eureka      security:     user:       name: root      password: rootlogging:  level:    root: debug    ---spring:  profiles: 7901server:   port: 7901eureka:  instance:    hostname: eureka-7901    client:    #设置服务注册中心的URL    service-url:                            defaultZone: http://root:root@eureka-7902:7902/eureka/---    spring:  profiles: 7902server:   port: 7902eureka:  instance:    hostname: eureka-7902    client:       #设置服务注册中心的URL    service-url:                            defaultZone: http://root:root@eureka-7901:7901/eureka/
</code>\`<code></p><p>—将配置文件分成2段-每段指定spring.profiles。第一段没有指定-所以共用。</p><p><li> 服务注册改造</li></p><p>    api-listen-order</p><p></code>\`<code>sh
eureka:   client:    #设置服务注册中心的URL    service-url:                            defaultZone: http://root:root@eureka-7901:7901/eureka/,http://root:root@eureka-7902:7902/eureka/
</code>\`<code></p><p>写一个地址也行（但是server得互相注册）-EurekaServer会自动同步-但为了避免极端情况-还是写多个。</p><p>集群PS:</p><p>集群中各个se`,
    author: defaultAuthor,
    readTime: '131 min read',
    relatedPosts: ["2020-06-23-spring-cloud-eurekaactuator","2020-07-02"],
  },
  {
    title: "MySQL Execution Plan Analysis",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog1.jpg',
    url: '/blog/2020-08-13-mysql',
    date: 'August 13, 2020',
    category: 'Database',
    tags: ["MySQL","Database"],
    slug: '2020-08-13-mysql',
    content: `<p><h1>MySQL执行计划详解</h1></p><p>​ 在企业的应用场景中-为了知道优化SQL语句的执行-需要查看SQL语句的具体执行过程-以加快SQL语句的执行效率。</p><p>​ 可以使用explain+SQL语句来模拟优化器执行SQL查询语句-从而知道mysql是如何处理sql语句的。</p><p>​ 官网地址： <a href="https://dev.mysql.com/doc/refman/5.5/en/explain-output.html">https://dev.mysql.com/doc/refman/5.5/en/explain-output.html</a></p><p><strong>执行计划中的信息</strong></p><p>Column</p><p>Meaning</p><p>id</p><p>查询中执行select子句或者操作表的顺序</p><p>select_type</p><p>是普通查询还是联合查询还是子查询</p><p>table</p><p>访问的表名或者别名-可能是临时表或者union合并结果集</p><p>type</p><p>数据扫描形式</p><p>possible_keys</p><p>显示可能应用在这张表中的索引-一个或多个</p><p>key</p><p>实际使用的索引-如果为null-则没有使用索引</p><p>key_len</p><p>索引中使用的字节数-在不损失精度的情况下长度越短越好。</p><p>ref</p><p>显示索引的哪一列被使用了-如果可能的话-是一个常数</p><p>rows</p><p>大致估算出找出所需记录需要读取的行数</p><p>filtered</p><p>Percentage of rows filtered by table condition</p><p>extra</p><p>Additional information</p><p><code>select_type</code> Value</p><p>Meaning</p><p>SIMPLE</p><p>Simple SELECT (not using UNION or subqueries)</p><p>PRIMARY</p><p>Outermost SELECT</p><p>UNION</p><p>Second or later SELECT statement in a UNION</p><p>DEPENDENT UNION</p><p>Second or later SELECT statement in a UNION, dependent on outer query</p><p>UNION RESULT</p><p>Result of a UNION.</p><p>SUBQUERY</p><p>First SELECT in subquery</p><p>DEPENDENT SUBQUERY</p><p>First SELECT in subquery, dependent on outer query</p><p>DERIVED</p><p>Derived table</p><p>UNCACHEABLE SUBQUERY</p><p>A subquery for which the result cannot be cached and must be re-evaluated for each row of the outer query</p><p>UNCACHEABLE UNION</p><p>The second or later select in a UNION that belongs to an uncacheable subquery (see UNCACHEABLE SUBQUERY)</p><p><strong>id</strong></p><p>select查询的序列号-包含一组数字-表示查询中执行select子句或者操作表的顺序</p><p>id号分为三种情况：</p><p>​ 1、如果id相同-那么执行顺序从上到下</p><p>\`\`<code>sql
explain select * from emp e join dept d on e.deptno = d.deptno join salgrade sg on e.sal between sg.losal and sg.hisal;
</code>\`<code></p><p>​ 2、如果id不同-如果是子查询-id的序号会递增-id值越大优先级越高-越先被执行</p><p></code>\`<code>sql
explain select * from emp e where e.deptno in (select d.deptno from dept d where d.dname = 'SALES');
</code>\`<code></p><p>​ 3、id相同和不同的-同时存在：相同的可以认为是一组-从上往下顺序执行-在所有组中-id值越大-优先级越高-越先执行</p><p></code>\`<code>sql
explain select * from emp e join dept d on e.deptno = d.deptno join salgrade sg on e.sal between sg.losal and sg.hisal where e.deptno in (select d.deptno from dept d where d.dname = 'SALES');
</code>\`<code></p><p><strong>select_type</strong></p><p>主要用来分辨查询的类型-是普通查询还是联合查询还是子查询</p><p></code>\`<code>sql
--sample:简单的查询-不包含子查询和unionexplain select * from emp;--primary:查询中若包含任何复杂的子查询-最外层查询则被标记为Primaryexplain select staname,ename supname from (select ename staname,mgr from emp) t join emp on t.mgr=emp.empno ;--union:若第二个select出现在union之后-则被标记为unionexplain select * from emp where deptno = 10 union select * from emp where sal >2000;--dependent union:跟union类似-此处的depentent表示union或union all联合而成的结果会受外部表影响explain select * from emp e where e.empno  in ( select empno from emp where deptno = 10 union select empno from emp where sal >2000)--union result:从union表获取结果的selectexplain select * from emp where deptno = 10 union select * from emp where sal >2000;--subquery:在select或者where列表中包含子查询explain select * from emp where sal > (select avg(sal) from emp) ;--dependent subquery:subquery的子查询要受到外部表查询的影响explain select * from emp e where e.deptno in (select distinct deptno from dept);--DERIVED: from子句中出现的子查询-也叫做派生类-explain select staname,ename supname from (select ename staname,mgr from emp) t join emp on t.mgr=emp.empno ;--UNCACHEABLE SUBQUERY：表示使用子查询的结果不能被缓存 explain select * from emp where empno = (select empno from emp where deptno=@@sort_buffer_size); --uncacheable union:表示union的查询结果不能被缓存：sql语句未验证
</code>\`<code></p><p><strong>table</strong></p><p>对应行正在访问哪一个表-表名或者别名-可能是临时表或者union合并结果集  
1、如果是具体的表名-则表明从实际的物理表中获取数据-当然也可以是表的别名</p><p>​ 2、表名是derivedN的形式-表示使用了id为N的查询产生的衍生表</p><p>​ 3、当有union result的时候-表名是union n1,n2等的形式-n1,n2表示参与union的id</p><p><strong>type</strong></p><p>type显示的是访问类型-访问类型表示我是以何种方式去访问我们的数据-最容易想的是全表扫描-直接暴力的遍历一张表去寻找需要的数据-效率非常低下-访问的类型有很多-效率从最好到最坏依次是：</p><p>system > const > eq_ref > ref > fulltext > ref_or_null > index_merge > unique_subquery > index_subquery > range > index > ALL</p><p>一般情况下-得保证查询至少达到range级别-最好能达到ref</p><p></code>\`<code>sql
--all:全表扫描-一般情况下出现这样的sql语句而且数据量比较大的话那么就需要进行优化。explain select * from emp;--index：全索引扫描这个比all的效率要好-主要有两种情况-一种是当前的查询时覆盖索引-即我们需要的数据在索引中就可以索取-或者是使用了索引进行排序-这样就避免数据的重排序explain  select empno from emp;--range：表示利用索引查询的时候限制了范围-在指定范围内进行查询-这样避免了index的全索引扫描-适用的操作符： =, <>, >, >=, <, <=, IS NULL, BETWEEN, LIKE, or IN() explain select * from emp where empno between 7000 and 7500;--index_subquery：利用索引来关联子查询-不再扫描全表explain select * from emp where emp.job in (select job from t_job);--unique_subquery:该连接类型类似与index_subquery,使用的是唯一索引 explain select * from emp e where e.deptno in (select distinct deptno from dept); --index_merge：在查询过程中需要多个索引组合使用-没有模拟出来--ref_or_null：对于某个字段即需要关联条件-也需要null值的情况下-查询优化器会选择这种访问方式explain select * from emp e where  e.mgr is null or e.mgr=7369;--ref：使用了非唯一性索`,
    author: defaultAuthor,
    readTime: '16 min read',
    relatedPosts: ["2020-05-03-mysql","2020-06-13-mysql"],
  },
  {
    title: "Spring Framework Internals",
    excerpt: "In-depth technical analysis with code examples and enterprise best practices.",
    image: '/img/blog2.jpg',
    url: '/blog/2020-08-24-spring',
    date: 'August 24, 2020',
    category: 'Spring',
    tags: ["Framework","Spring"],
    slug: '2020-08-24-spring',
    content: `<p><h1>Spring原理讲解</h1></p><p><h3>1、什么是Spring框架-Spring框架主要包含哪些模块</h3></p><p>​ Spring是一个开源框架-Spring是一个轻量级的Java 开发框架。它是为了解决企业应用开发的复杂性而创建的。框架的主要优势之一就是其分层架构-分层架构允许使用者选择使用哪一个组件-同时为 J2EE 应用程序开发提供集成的框架。Spring使用基本的JavaBean来完成以前只可能由EJB完成的事情。然而-Spring的用途不仅限于服务器端的开发。从简单性、可测试性和松耦合的角度而言-任何Java应用都可以从Spring中受益。Spring的核心是控制反转（IoC）和面向切面（AOP）。简单来说-Spring是一个分层的full-stack(一站式) 轻量级开源框架。</p><p>主要包含的模块：</p><p><img src="/images/blog/spring-overview.png" alt="illustration" class="my-4" /></p><p><h3>2、Spring框架的优势</h3></p><p>​ 1、Spring通过DI、AOP和消除样板式代码来简化企业级Java开发</p><p>​ 2、Spring框架之外还存在一个构建在核心框架之上的庞大生态圈-它将Spring扩展到不同的领域-如Web服务、REST、移动开发以及NoSQL</p><p>​ 3、低侵入式设计-代码的污染极低</p><p>​ 4、独立于各种应用服务器-基于Spring框架的应用-可以真正实现Write Once,Run Anywhere的承诺</p><p>​ 5、Spring的IoC容器降低了业务对象替换的复杂性-提高了组件之间的解耦</p><p>​ 6、Spring的AOP允许将一些通用任务如安全、事务、日志等进行集中式处理-从而提供了更好的复用</p><p>​ 7、Spring的ORM和DAO提供了与第三方持久层框架的的良好整合-并简化了底层的数据库访问</p><p>​ 8、Spring的高度开放性-并不强制应用完全依赖于Spring-开发者可自由选用Spring框架的部分或全部</p><p><h3>3、IOC和DI是什么？</h3></p><p>​ 控制反转是就是应用本身不负责依赖对象的创建和维护,依赖对象的创建及维护是由外部容器负责的,这样控制权就有应用转移到了外部容器,控制权的转移就是控制反转。</p><p>​ 依赖注入是指:在程序运行期间,由外部容器动态地将依赖对象注入到组件中如：一般-通过构造函数注入或者setter注入。</p><p><h3>4、描述下Spring IOC容器的初始化过程</h3></p><p>​ Spring IOC容器的初始化简单的可以分为三个过程：</p><p>​ 第一个过程是Resource资源定位。这个Resouce指的是BeanDefinition的资源定位。这个过程就是容器找数据的过程-就像水桶装水需要先找到水一样。</p><p>​ 第二个过程是BeanDefinition的载入过程。这个载入过程是把用户定义好的Bean表示成Ioc容器内部的数据结构-而这个容器内部的数据结构就是BeanDefition。</p><p>​ 第三个过程是向IOC容器注册这些BeanDefinition的过程-这个过程就是将前面的BeanDefition保存到HashMap中的过程。</p><p><h3>5、BeanFactory 和 FactoryBean的区别？</h3></p><p><li><strong>BeanFactory</strong>是个Factory-也就是IOC容器或对象工厂-在Spring中-所有的Bean都是由BeanFactory(也就是IOC容器)来进行管理的-提供了实例化对象和拿对象的功能。</li></p><p>  使用场景：
  - 从Ioc容器中获取Bean(byName or byType)
  - 检索Ioc容器中是否包含指定的Bean
  - 判断Bean是否为单例</p><p><li><strong>FactoryBean</strong>是个Bean-这个Bean不是简单的Bean-而是一个能生产或者修饰对象生成的工厂Bean,它的实现与设计模式中的工厂模式和修饰器模式类似。</li></p><p>  使用场景
  - ProxyFactoryBean</p><p><h3>6、BeanFactory和ApplicationContext的异同</h3></p><p><img src="/images/blog/ApplicationContext%E7%B1%BB%E5%9B%BE.png" alt="illustration" class="my-4" /></p><p>相同：</p><p><li>Spring提供了两种不同的IOC 容器-一个是BeanFactory-另外一个是ApplicationContext-它们都是Java interface-ApplicationContext继承于BeanFactory(ApplicationContext继承ListableBeanFactory。</li>
<li>它们都可以用来配置XML属性-也支持属性的自动注入。</li>
<li>而ListableBeanFactory继承BeanFactory)-BeanFactory 和 ApplicationContext 都提供了一种方式-使用getBean(“bean name”)获取bean。</li></p><p>不同：</p><p><li>当你调用getBean()方法时-BeanFactory仅实例化bean-而ApplicationContext 在启动容器的时候实例化单例bean-不会等待调用getBean()方法时再实例化。</li>
<li>BeanFactory不支持国际化-即i18n-但ApplicationContext提供了对它的支持。</li>
<li>BeanFactory与ApplicationContext之间的另一个区别是能够将事件发布到注册为监听器的bean。</li>
<li>BeanFactory 的一个核心实现是XMLBeanFactory 而ApplicationContext 的一个核心实现是ClassPathXmlApplicationContext-Web容器的环境我们使用WebApplicationContext并且增加了getServletContext 方法。</li>
<li>如果使用自动注入并使用BeanFactory-则需要使用API注册AutoWiredBeanPostProcessor-如果使用ApplicationContext-则可以使用XML进行配置。</li>
<li>简而言之-BeanFactory提供基本的IOC和DI功能-而ApplicationContext提供高级功能-BeanFactory可用于测试和非生产使用-但ApplicationContext是功能更丰富的容器实现-应该优于BeanFactory</li></p><p><h3>7、Spring Bean 的生命周期？</h3></p><p><img src="/images/blog/bean%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F.png" alt="illustration" class="my-4" /></p><p>总结：</p><p><strong>（1）实例化Bean：</strong></p><p>对于BeanFactory容器-当客户向容器请求一个尚未初始化的bean时-或初始化bean的时候需要注入另一个尚未初始化的依赖时-容器就会调用createBean进行实例化。对于ApplicationContext容器-当容器启动结束后-通过获取BeanDefinition对象中的信息-实例化所有的bean。</p><p><strong>（2）设置对象属性（依赖注入）：</strong></p><p>实例化后的对象被封装在BeanWrapper对象中-紧接着-Spring根据BeanDefinition中的信息 以及 通过BeanWrapper提供的设置属性的接口完成依赖注入。</p><p><strong>（3）处理Aware接口：</strong></p><p>接着-Spring会检测该对象是否实现了xxxAware接口-并将相关的xxxAware实例注入给Bean：</p><p>①如果这个Bean已经实现了BeanNameAware接口-会调用它实现的setBeanName(String beanId)方法-此处传递的就是Spring配置文件中Bean的id值；</p><p>②如果这个Bean已经实现了BeanFactoryAware接口-会调用它实现的setBeanFactory()方法-传递的是Spring工厂自身。</p><p>③如果这个Bean已经实现了ApplicationContextAware接口-会调用setApplicationContext(ApplicationContext)方法-传入Spring上下文；</p><p><strong>（4）BeanPostProcessor：</strong></p><p>如果想对Bean进行一些自定义的处理-那么可以让Bean实现了BeanPostProcessor接口-那将会调用postProcessBeforeInitialization(Object obj, String s)方法。</p><p><strong>（5）InitializingBean 与 init-method：</strong></p><p>如果Bean在Spring配置文件中配置了 init-method 属性-则会自动调用其配置的初始化方法。</p><p><strong>（6）如果这个Bean实现了BeanPostProcessor接口</strong>-将会调用postProcessAfterInitialization(Object obj, String s)方法；由于这个方法是在Bean初始化结束时调用的-所以可以被应用于内存或缓存技术；</p><p>以上几个步骤完成后-Bean就已经被正确创建了-之后就可以使用这个Bean了。</p><p><strong>（7）DisposableBean：</strong></p><p>当Bean不再需要时-会经过清理阶段-如果Bean实现了DisposableBean这个接口-会调用其实现的destroy()方法；</p><p><strong>（8）destroy-method：</strong></p><p>最后-如果这个Bean的Spring配置中配置了destroy-method属性-会自动调用其配置的销毁方法。</p><p><h3>8、Spring AOP的实现原理？</h3></p><p>​ Spring AOP使用的动态代理-所谓的动态代理就是说AOP框架不会去修改字节码-而是在内存中临时为方法生成一个AOP对象-这个AOP对象包含了目标对象的全部方法-并且在特定的切点做了增强处理-并回调原对象的方法。</p><p>​ Spring AOP中的动态代理主要有两种方式-JDK动态代理和CGLIB动态代理。JDK动态代理通过反射来接收被代理的类-并且要求被代理的类必须实现一个接口。JDK动态代理的核心是InvocationHandler接口和Proxy类。</p><p>​ 如果目标类没有实现接口-那么Spring AOP会选择使用CGLIB来动态代理目标类。CGLIB（Code Generation Library）-是一个代码生成的类库-可以在运行时动态的生成某个类的子类-注意-CGLI`,
    author: defaultAuthor,
    readTime: '20 min read',
    relatedPosts: ["2020-04-03-spring-ioc","2020-05-22-ioc"],
  }
];
