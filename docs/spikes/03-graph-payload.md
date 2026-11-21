# Graph snapshot payload spike

## Verdict

**Use indexed columnar JSON with revision-bound, byte-bounded pages.** At 10,000 nodes and 100,000 synthetic edges, ordinary object JSON was 17,023,538 bytes and could not enter acon's 4 MiB cache. Columnar JSON was 3,603,833 bytes and fit this particular dataset, but is not guaranteed to fit when labels, paths, metadata or optional fields grow. Five experimental pages had a maximum of 1,760,910 bytes. Choose pages by actual serialized UTF-8 byte size, not by a fixed edge count, and bound both node and edge pages.

The proposed shape below is input for vault-mem core issue [#266](https://github.com/STAIxBWLB/vault-mem/issues/266); it is not an implemented contract. The benchmark does not measure graph construction, Leiden, provider startup, HTTP transfer or browser rendering and therefore does not demonstrate that the whole provider call meets the 30 s deadline.

## Measurements

Bun 1.4.4, macOS arm64, Apple M5 Max, 64 GB RAM. The harness below uses deterministic synthetic ASCII strings, 10,000 nodes and 100,000 unique undirected edges. Each node has an id, label, type, domain, source file, community, degree, update time, date and placeholder flag. Each edge has source, target, one of six relations, nullable field and rel, and fixed extracted confidence. The compact version uses parallel arrays, numeric node indices and a relation dictionary; common confidence is encoded once. It verifies unique edges and checks endpoint, relation, field and rel mapping against the plain graph.

After two warmups, 10 samples each; p95 is the nearest-rank maximum of those 10 samples. Serialization and parsing are timed separately. Paged times are the total for all five pages, not a single-page latency. Gzip is measured separately, without timing it.

| Encoding | Pages | Raw total (bytes) | Largest raw page | Gzip total (bytes) | Largest gzip page | Serialize p50 / p95 (ms) | Parse p50 / p95 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Plain object JSON | 1 | 17,023,538 | 17,023,538 | 837,946 | 837,946 | 5.20 / 7.58 | 10.37 / 11.31 |
| Indexed columnar JSON | 1 | 3,603,833 | 3,603,833 | 527,631 | 527,631 | 2.09 / 2.54 | 3.38 / 4.80 |
| Columnar, 20,000 edges per page | 5 | 3,605,784 | 1,760,910 | 532,553 | 174,956 | 1.95 / 2.08 | 3.23 / 3.73 |

The fixture is highly repetitive, so gzip ratios and timing must not be extrapolated to real vaults. It omits optional `description`, `topics` and node `confidence`, and does not model long paths, multilingual text, unusually large individual fields or variable graph metadata. The quoted gzip values are informational: `agent-console` `src/snapshot-cache.ts` at `8babe31f421682670a17ee2498f485e6f9ea20a5` caches the uncompressed JSON string and counts its UTF-8 bytes plus the cache key and version. The 4 MiB limit is shared across cache entries, not a reservation per page; even a smaller page can evict other entries. `src/server.ts` sets the default provider deadline to 30,000 ms. No actual provider call or cache admission was timed here.

## Proposed provider shape

- Begin a graph snapshot with the vault selection and no cursor. Return a schema version, opaque revision, graph metadata, total node and edge counts, a page kind, column arrays, offset and an opaque `next` cursor or `null`. Include explicit `directed`, `multigraph` and Leiden metadata, including resolution, modularity, iterations and maximum iterations.
- Assign nodes a stable zero-based index within this revision. A node page has aligned arrays for `id`, `label`, `type`, `domain`, `source_file`, `community`, `degree`, `updated`, `date` and `placeholder`; include optional `description`, `confidence` and `topics` as nullable columns when needed. `source_file` carries the note path. Preserve absent values as `null`; do not invent dates, community or other metadata. Placeholder nodes represent unresolved link targets and retain their identity and placeholder flag.
- After all node pages, return edge pages with aligned `source` and `target` integer arrays referring to the complete revision's node indices, a relation dictionary and integer relation column, plus nullable `field` and `rel`. Preserve `confidence_tag` and `confidence`: use one page-level value only if uniform, otherwise send aligned columns. Retain any additional graph attributes the view needs rather than silently dropping them. Rows are aligned by column index; indices are never page-local.
- Enforce a conservative maximum such as **1 MiB of serialized UTF-8 JSON per reply**, including envelope, metadata and cursor. Accumulate rows until adding the next would exceed the cap. Page node columns as well as edges, and return an explicit actionable error for a single row that cannot fit rather than truncate it. The 1 MiB target leaves cache-accounting headroom but does not guarantee retention in a shared LRU.
- Bind an opaque cursor to the vault, graph revision, schema version, page kind, offset and any graph options. It must not expose note text or credentials. Resolve each page from one immutable revision or reject an expired/changed revision with an actionable restart; never mix revisions. Return totals and contiguous offsets so the client detects missing, duplicate or out-of-order pages. Validate indices and column lengths before use. On a new revision, discard the partial old assembly. Define cancellation and snapshot retention limits in the core implementation.
- Fetch subsequent pages only as needed, not as an unbounded concurrent fan-out. A graph too large to construct within 30 s still needs independent provider-side measurement or a different incremental design; paging serialization alone does not solve construction time.

The 20,000-edge test pages put all nodes on the first page; this is a measurement fixture, not the proposed byte-bounded paging algorithm. The fixture has no cursor integrity, mutation, overflow, concurrent-client or cache-eviction test. Core implementation should validate those cases and measure realistic and worst-case data without recording note contents.

## Reproduction

Save the following as `bench.mjs` and run `bun bench.mjs` with Bun 1.4.4. It generates all data in memory and writes no vault data. `gzipSync` uses the runtime's default compression settings. Times vary with hardware and load; compare the byte counts and mapping assertions first.

```js
import {gzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const N=10000, E=100000, K=20000;
const relations=['wiki_link','fm_ref','bu_member','source_ref','related','supersedes'];
const nodes=Array.from({length:N},(_,i)=>({id:`notes/note-${i}`,label:`Synthetic note ${i}`,type:i%2?'concept':'project',domain:`domain-${i%20}`,source_file:`notes/note-${i}.md`,community:i%50,degree:20,updated:'2026-11-21T00:00:00Z',date:'2026-11-21',placeholder:i%100===0}));
const edges=Array.from({length:E},(_,i)=>({source:nodes[i%N].id,target:nodes[(i%N+1+Math.floor(i/N))%N].id,relation:relations[i%relations.length],field:i%7===0?'related':null,rel:i%11===0?'supports':null,confidence_tag:'EXTRACTED',confidence:1}));
const meta={directed:false,multigraph:false,partitioner:'leiden',resolution:1,modularity:0.4,iterations:3,max_iterations:256};
const plain={revision:'synthetic-revision-1',graph:meta,nodes,edges};
const columns={id:[],label:[],type:[],domain:[],source_file:[],community:[],degree:[],updated:[],date:[],placeholder:[]};
for(const n of nodes) for(const k of Object.keys(columns)) columns[k].push(n[k]);
const compactEdges={source:[],target:[],relation:[],field:[],rel:[]};
for(let i=0;i<E;i++){const e=edges[i];compactEdges.source.push(i%N);compactEdges.target.push((i%N+1+Math.floor(i/N))%N);compactEdges.relation.push(i%relations.length);compactEdges.field.push(e.field);compactEdges.rel.push(e.rel)}
const compact={revision:plain.revision,graph:meta,relations,confidence_tag:'EXTRACTED',confidence:1,nodes:columns,edges:compactEdges};
const pages=[];
for(let start=0;start<E;start+=K){const edgeColumns=Object.fromEntries(Object.entries(compactEdges).map(([k,v])=>[k,v.slice(start,start+K)]));pages.push({revision:plain.revision,graph:meta,relations,confidence_tag:'EXTRACTED',confidence:1,nodeCount:N,edgeCount:E,nodeOffset:0,nodes:start===0?columns:null,edgeOffset:start,edges:edgeColumns,next:start+K<E?`cursor-${start+K}`:null});}
assert.equal(nodes.length,N); assert.equal(edges.length,E); assert.equal(new Set(edges.map(e=>[e.source,e.target].sort().join('|'))).size,E);
for(let i=0;i<E;i++){const e=edges[i];assert.equal(nodes[compactEdges.source[i]].id,e.source);assert.equal(nodes[compactEdges.target[i]].id,e.target);assert.equal(relations[compactEdges.relation[i]],e.relation);assert.equal(compactEdges.field[i],e.field);assert.equal(compactEdges.rel[i],e.rel)}
const bytes=s=>Buffer.byteLength(s); const p=(v,q)=>v.toSorted((a,b)=>a-b)[Math.ceil(v.length*q)-1];
function measure(name,values){let enc=[],dec=[],raw=[],zip=[];for(const value of values){const s=JSON.stringify(value);raw.push(bytes(s));zip.push(gzipSync(s).length)}for(let i=0;i<12;i++){let t=performance.now();const strings=values.map(v=>JSON.stringify(v));let elapsed=performance.now()-t;t=performance.now();strings.map(s=>JSON.parse(s));let parsed=performance.now()-t;if(i>=2){enc.push(elapsed);dec.push(parsed)}}return {name,pages:values.length,rawTotal:raw.reduce((a,b)=>a+b,0),rawMax:Math.max(...raw),gzipTotal:zip.reduce((a,b)=>a+b,0),gzipMax:Math.max(...zip),serializeMsP50:p(enc,.5),serializeMsP95:p(enc,.95),parseMsP50:p(dec,.5),parseMsP95:p(dec,.95)}}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,iterations:10,warmups:2,results:[measure('plain',[plain]),measure('compact',[compact]),measure('paged',pages)]},null,2));

```
