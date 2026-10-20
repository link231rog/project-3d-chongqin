# 架构与数据

## 模块

| 文件 | 职责 |
| --- | --- |
| `src/main.js` | 入口、渲染器、灯光/天空/水面、来福士、千厮门/东水门、车辆/索道/游船、UI、合影、动画时钟 |
| `src/peninsula.js` | 解码底图与高程、地形/河岸、公园、普通楼宇、道路、重点地标、地图锚点 |
| `src/quarters.js` | 湖广会馆、十八梯、李子坝建筑与单轨、排除重复建筑、李子坝动画更新 |
| `src/elevation.js` | 纯双线性插值，网格边缘外夹取边界值 |
| `src/zengjiayan.js` | 曾家岩桥（西侧母城分界地标），返回观景中心点 |
| `src/bridge-member.js` | 桥梁杆件几何，正确处理水平、斜向与竖向截面朝向 |
| `index.html` / `src/style.css` | 控件、相框dialog、布局与主题；HTML含本地文件入口跳转 |

`init()` 先等待 `buildPeninsula()`，再创建其他模型和UI；完成后启动 `animate()`。主体是原生Three.js，没有React、路由器或后端。

## 坐标与尺度

原点WGS84：`[106.5888, 29.5715]`；每世界单位约12米。

```js
x = (longitude - 106.5888) * 96800 / 12;
z = -(latitude - 29.5715) * 111320 / 12;
y = Math.max(0.7, (elevationMeters - 167) / 12);
```

X向东，Z向南，Y向上。167米是固定展示基准，不是实时水位。水面Y=0.2。不要把经纬度、真实米制和旧手工模型坐标混用。

地形通过自适应细分采样SRTM；楼宇基础从轮廓最低地面延伸到最高地面上方。楼高优先 `height`，其次 `building:levels × 3.2m`，缺失则18m。高度有数据也不保证数据最新或与模型塔号一致。

## 资源格式

`peninsula-snapshot.json` 与 `peninsula-elevation.json` 是 `{ encoding, data }` 包装，`data` 为 deflate 后的base64。浏览器用 `DecompressionStream('deflate')` 解码。

底图解码后：

```text
meta: origin, metersPerUnit, source, retrieved, districtRelation, waterRelations...
land: 闭合 [x,z] 轮廓
buildings: [osmWayId, name, height|null, levels|null, footprint, buildingType]
roads: [osmWayId, name, highwayKind, bridgeTag, points]
landmarks: [osmId, name, points]
```

高程解码后有 `west/south/stepLongitude/stepLatitude/columns/rows/elevations`；行序由南向北，列序由西向东。7049样本=133列×53行，EGM96高程。

其他JSON是普通资源：`peninsula-parks.json` 三处公园；`liziba-tracks.json` 站楼与线路；`jialing-water.json` 嘉陵江水色mask轮廓。对岸荒坡与西侧外围原多边形已裁撤，聚焦母城半岛精致微缩。

现有底图 `meta.terrain` 还留有早期插值描述；实际运行使用独立SRTM文件，`group.userData.source.terrain` 已覆盖。不要按这条旧文字把高程改回假山曲面。采集脚本中的新输出描述已修正。

## 不能破坏的约束

- 千厮门/东水门通过 `alignBridgeToMap()` 用完整仿射矩阵落位。必须保留 `matrixAutoUpdate=false` 和直接矩阵写入；非均匀缩放后分解TRS会丢失剪切，车和桥会错位。
- 水面使用单个平面与嘉陵江轮廓mask，合流下游用长江色；shader须使用与其他网格一致的对数深度。
- `cameraTweens` 与 `environmentTweens` 是独立TWEEN组，手动控制应中断镜头动画。
- 车辆/地铁共用 `trafficTime`，暂停时不推进；菜园坝更新和李子坝更新都要接在同一暂停分支。
- 夜景材质注册到 `buildingNightEmissives`，结构为 `{material, baseIntensity, property?}`；默认控制 `emissiveIntensity`，透明灯带/光束使用 `opacity`。
- 地标交互读取 `userData.name` 和 `userData.desc`。
- 添加观景预设时同步 `setupUI()`、侧栏按钮与合影页select。
- 合影用定格画布作为背景；上传图片以object URL读取；关闭时取消拖动/旧异步加载并恢复自转。不要开启常驻人像层。
- 全景边界只计算渝中本体，外扩对岸不能重复扩大沙盘和水面边界。
