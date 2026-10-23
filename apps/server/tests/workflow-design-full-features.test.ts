import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'client');

describe('TC-03-02-003: 流程设计器页面完整交互与样式功能守卫 (拖拽/缩放/DAG重排/前后连线/删除/主题/命名空间)', () => {
  const designPath = path.join(clientDir, 'config-workflow-design.html');
  const workflowsPath = path.join(clientDir, 'config-workflows.html');

  it('config-workflows.html 资产库「Dify 可视化设计」跳转链接必须指向 config-workflow-design.html?id=...', () => {
    const html = fs.readFileSync(workflowsPath, 'utf8');
    assert.ok(
      html.includes('href="config-workflow-design.html?id='),
      '资产库必须链接到 config-workflow-design.html',
    );
  });

  it('设计器必须具备鼠标拖拽移动节点与实时贝塞尔重算 (handleNodeMouseDown / handleSvgMouseMove)', () => {
    const html = fs.readFileSync(designPath, 'utf8');
    assert.ok(html.includes('handleNodeMouseDown'), '必须具备节点按下开始拖动');
    assert.ok(html.includes('handleSvgMouseMove'), '必须具备 SVG 鼠标移动更新坐标');
    assert.ok(html.includes('handleSvgMouseUp'), '必须具备释放鼠标结束拖动');
    assert.ok(html.includes('nodeCoordinates'), '必须具备节点物理坐标 Map 维护自由拖拽');
  });

  it('设计器必须具备画布缩放 (40%~200%) 与平移 (Pan) 功能 (setCanvasZoom / handleCanvasPanMouseDown)', () => {
    const html = fs.readFileSync(designPath, 'utf8');
    assert.ok(html.includes('setCanvasZoom') || html.includes('zoomCanvas'), '必须具备画布缩放函数');
    assert.ok(html.includes('handleCanvasPanMouseDown'), '必须具备抓手平移画布函数');
    assert.ok(html.includes('resetCanvasView'), '必须具备重置视图');
  });

  it('设计器必须具备专业 DAG 拓扑分层去交叉自动整理 (autoLayoutNodes / breakCycles / longest-path)', () => {
    const html = fs.readFileSync(designPath, 'utf8');
    assert.ok(html.includes('autoLayoutNodes'), '必须具备自动排版整理');
    assert.ok(html.includes('breakCycles'), '必须包含环路检测避免回环拉乱分层');
    assert.ok(html.includes('dagOut') || html.includes('topo'), '必须包含标准拓扑排序与分层');
  });

  it('设计器必须具备前后指定连线与快捷删除节点 (addLinkFromSelect / addLinkToSelect / deleteCurrentSelectedNode)', () => {
    const html = fs.readFileSync(designPath, 'utf8');
    assert.ok(html.includes('addLinkFromSelect') || html.includes('addSequenceFlow'), '必须支持连出指定');
    assert.ok(html.includes('addLinkToSelect'), '必须支持连入指定');
    assert.ok(html.includes('removeLink'), '必须支持删除连线');
    assert.ok(html.includes('deleteCurrentSelectedNode'), '必须支持快捷删除节点并级联删流');
  });

  it('设计器必须支持命名空间前缀无关解析 (兼容 bpmn:/bpmn2:/无前缀)', () => {
    const html = fs.readFileSync(designPath, 'utf8');
    assert.ok(
      html.includes('(?:[a-zA-Z0-9_]+:)?'),
      '解析正则必须包含前缀无关匹配 (?:[a-zA-Z0-9_]+:)?',
    );
  });

  it('设计器必须完整引入主题 (theme.js) 与现代化样式 (shared.css) 且顶层布局不塌陷', () => {
    const html = fs.readFileSync(designPath, 'utf8');
    assert.ok(html.includes('css/shared.css'), '必须引入 shared.css');
    assert.ok(html.includes('js/theme.js'), '必须引入 theme.js');
    assert.ok(html.includes('js/toast.js'), '必须引入 toast.js');
    assert.ok(!html.includes('class="bg-[#070a12] text-slate-100 font-sans app-shell"'), '不得带导致垂直挤压的 app-shell');
  });
});
