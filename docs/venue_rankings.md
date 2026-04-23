# Venue Rankings And Metrics

系统会在研究任务里对 `venue` 做两类补充：

1. 自动补充公开可查指标
   - `source_type`
   - `venue_citation_count`
   - `venue_works_count`
   - `h_index`
   - `i10_index`
   - `issn / issn_l`

2. 从本地目录文件补充分级与索引
   - `CCF`
   - `SCI`
   - `JCR`
   - `中科院分区`
   - `EI`
   - `IF`

默认目录位置：

```text
data/venue_rankings/venue_catalog.csv
```

CSV 表头：

```csv
venue,aliases,source_type,ccf_rank,ccf_category,sci_indexed,ei_indexed,jcr_quartile,jcr_year,cas_quartile,cas_top,impact_factor,impact_factor_year
```

字段说明：

- `venue`: 主名称
- `aliases`: 备用名称，使用 `|` 分隔，例如 `ACL|Annual Meeting of the Association for Computational Linguistics`
- `source_type`: `journal` 或 `conference`
- `ccf_rank`: `A/B/C`
- `ccf_category`: CCF 学科分类，例如 `AI`
- `sci_indexed`: `true/false`
- `ei_indexed`: `true/false`
- `jcr_quartile`: `Q1/Q2/Q3/Q4`
- `jcr_year`: JCR 年份
- `cas_quartile`: 中科院分区，例如 `1区`
- `cas_top`: `Top` 等附加说明
- `impact_factor`: IF 数值
- `impact_factor_year`: IF 年份

说明：

- `CCF/JCR/中科院/EI/IF` 默认不做公开站点抓取，优先使用你维护的本地目录。
- 公开来源只用于补充 `OpenAlex` 可直接返回的来源级指标与引用统计。
