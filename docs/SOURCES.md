# 资料与证据范围

本表记录当前模型使用过的来源，交接时没有重新逐页核验全部网页的可访问性。模型已实现某个形状，不代表该形状全部经过测绘核实。政府资料、设计论文、OSM轮廓与估算应分别使用。

## 地理与基础数据

| 内容 | 来源与支持范围 | 限制 |
| --- | --- | --- |
| 渝中区界 | https://www.openstreetmap.org/relation/4738525 | 行政边界不等于现状岸线；本体扣除了河流水域 |
| 嘉陵江水域 | https://www.openstreetmap.org/relation/12982622 | 用作水色mask；无实时水位 |
| 长江水域 | https://www.openstreetmap.org/relation/9087399 | 用于扣水与对岸裁剪 |
| 西侧通陆、两江环抱 | https://www.cqyz.gov.cn/zjyz/yzgk/zrdl/202302/t20230223_11646635.html | 支持地理拓扑和公开高差，不是地形测绘网格 |
| SRTM接口 | https://www.opentopodata.org/datasets/srtm/ | 数据被下采样至约80—93米间隔 |
| SRTM基准与数据范围 | https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm | 2000年卫星表面高程，包含建筑/植被偏差，不能代表当前街道地面 |
| 地图许可 | https://www.openstreetmap.org/copyright | 页面与导出合影保留OSM署名及ODbL信息 |

快照中的建筑高度只有部分来自height/levels；其余使用默认值。不要在界面声称“全部精准还原”。

## 建筑与街区

| 对象 | 来源 | 当前证据与不足 |
| --- | --- | --- |
| 来福士 | https://www.safdiearchitects.com/projects/raffles-city-chongqing | 8塔及水晶连廊总体；曲线、排布和立面仍需精校 |
| 来福士设计者建成后资料 | https://s3.amazonaws.com/safdie-staging/57819988-e2c3-4c10-91eb-2080d79b915e/Journal2020_IssueIII.pdf | 234.5/255.6/354.5米高度参考；需核对模型塔号，不能直接相信OSM中每个塔名/高度对应 |
| 解放碑 | https://dfz.cq.gov.cn/zqlswh/fjms_417821/202311/t20231102_12511619.html | 27.5米、八角、四钟；雕饰未完整制作 |
| 人民大礼堂 | https://www.cqyz.gov.cn/zjyz/lyyz/lswh/lsww/202210/t20221008_11166849.html | 65米和传统屋顶/对称格局；具体构件近似 |
| 洪崖洞 | https://zfcxjw.cq.gov.cn/cqcjdag/csjy/202504/t20250416_14526589.html | 11层、79米；不是逐间建筑复原 |
| 湖广会馆 | https://whlyw.cq.gov.cn/zjwl/yzq/cqwlzy/zqwwzy/202405/t20240507_13182428.html | 院落、公所组成；OSM范围866088553，层高/装修多为估算 |
| 十八梯格局 | https://www.cqyz.gov.cn/zwgk_229/jytabl/rddbjy/202206/t20220606_10781311.html | 七街六巷；范围312090249，未逐栋测绘 |
| 十八梯高差报道 | https://www.cq.gov.cn/ywdt/zwhd/qxdt/202109/t20210923_9745036.html | 约70米是片区描述，不应强制当作两个采样点的高程差 |
| 李子坝轨道层 | https://www.cq.gov.cn/zjcq/cycq/jplyxl/dsy/dsjp/202608/t20260826_15982335.html | 6—7层轨道空间；层高和装修仍估算 |
| 李子坝19层及结构分离 | https://m.12371.gov.cn/content/2025-09/11/content_498761.html | 建筑/轨道结构背景；未据此声称全部细部完成 |
| 李子坝改造现状 | https://www.cq.gov.cn/ywdt/jrcq/202606/t20260613_15751500.html | 有在建改造，不应预建并称为已建成设施 |
| 鹅岭公园 | https://mzj.cq.gov.cn/sy_218/bmdt/mzyw/202411/t20241101_13760704.html | 公园与山脊背景；树木示意 |
| 枇杷山公园 | https://cgj.cq.gov.cn/rdzt/ylsmypcswm/202206/t20220602_10775608.html | 园林背景；植被与小品未完整核实 |

## 桥梁、索道与列车

| 对象 | 来源 | 支持内容与注意事项 |
| --- | --- | --- |
| 千厮门 | https://zfcxjw.cq.gov.cn/zjzj/tszj/qdcq/202211/t20221128_11339950.html | 单塔单索面、钢桁梁、公轨6号线；现模型仍是旧资产地图适配 |
| 东水门 | https://dfz.cq.gov.cn/zqlswh/rwby_417819/202406/t20240605_13267997.html | 双塔172.61/162.49米；其他细部待核 |
| 曾家岩跨度 | https://www.cq.gov.cn/zwgk/zfxxgkzl/fdzdgknr/zdxm/dtxx/201909/t20190904_8808071.html | 135＋270＋135米 |
| 曾家岩桥宽 | https://www.cq.gov.cn/zwgk/zfxxgkzl/fdzdgknr/zdxm/dtxx/201808/t20180816_8807832.html | 32.6米；早期香槟金效果图不能当作建成配色 |
| 曾家岩建成配色/层级 | https://www.cq.gov.cn/zwgk/zfxxgkzl/fdzdgknr/zdxm/dtxx/202009/t20200901_8808316.html | 中国红、六车道、路上轨下；主墩位置/截面未精测 |
| 牛角沱结构 | https://zfcxjw.cq.gov.cn/cqcjdag/csjy/202503/t20250307_14381409.html | 68＋80＋88＋80＋68米及档案图 |
| 牛角沱桥宽 | https://dfz.cq.gov.cn/zqlswh/rwby_417819/202405/t20240516_13210375.html | 21.5米、车行14米、人行各3.75米；两份官方总长不同，模型不据此强行统一全长 |
| 菜园坝建成尺寸 | https://dfz.cq.gov.cn/zqlswh/rwby_417819/202406/t20240605_13268009.html | 主桥800米、桁高11.2米、顶宽39.8米、底宽13米、拱肋2.4×4米 |
| 菜园坝设计者论文 | https://caminstech.upc.edu/sites/default/files/Design%20of%20the%20Main%20Spans%20of%20the%20Chongqing%20Caiyuanba%20Bridge.pdf | Y构/提篮拱、悬吊、双层结构；属于2004年设计资料，宽度等与建成后资料有差别 |
| 菜园坝结构研究 | https://www.mdpi.com/2076-3417/8/4/650 | 88＋102＋420＋102＋88米、钢拱320米、矢高56.44米、内倾10.67°；模型主墩落位仍近似 |
| 菜园坝单轨路径 | https://www.openstreetmap.org/way/767445055 与 https://www.openstreetmap.org/way/1055889726 | 两条线路；高度未由OSM测定 |
| 长江索道 | https://www.cqsuodao.com/ | 新华路—上新街、1166米背景；吊厢与垂度估算 |
| 2号线编组 | https://jtj.cq.gov.cn/sy_240/bmdt/202305/t20230515_11963389.html | 公开混编记录；模型动画不是实时运行图 |
| 3号线八辆编组 | https://jtj.cq.gov.cn/sy_240/bmdt/202410/t20241021_13722428.html | 八辆编组存在；不等于模型速度、时刻或所有列车均准确 |

李子坝站楼OSM ID481835399；线路方向A用584178337、584178334、825814199，方向B用825814197、775318791、775318790。西侧外围桥梁与线路已随母城边界裁剪（曾家岩以东）。
