export type BpmnNodeType =
  | 'startEvent'
  | 'endEvent'
  | 'serviceTask'
  | 'userTask'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'task';

export interface BpmnNode {
  id: string;
  name?: string;
  type: BpmnNodeType;
  incoming: string[];
  outgoing: string[];
  defaultFlow?: string;
  parameters?: Record<string, string>;
}

export interface BpmnFlow {
  id: string;
  name?: string;
  sourceRef: string;
  targetRef: string;
  conditionExpression?: string;
}

export interface BpmnBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BpmnWaypoint {
  x: number;
  y: number;
}

export interface BpmnEdgeLayout {
  waypoints: BpmnWaypoint[];
}

export interface BpmnDiagramLayout {
  shapes: Record<string, BpmnBounds>;
  edges: Record<string, BpmnEdgeLayout>;
}

export interface BpmnProcessModel {
  id: string;
  name?: string;
  isExecutable: boolean;
  nodes: BpmnNode[];
  flows: BpmnFlow[];
  layout?: BpmnDiagramLayout;
}

function decodeXmlEntities(val: string): string {
  return val
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3] ?? '';
    attrs[key] = decodeXmlEntities(value);
  }
  return attrs;
}

function extractTagContent(content: string, localTagName: string): string[] {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${localTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>`, 'g');
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function findXmlBlocks(content: string, localTagName: string): Array<{ attributes: Record<string, string>; inner: string }> {
  const blocks: Array<{ attributes: Record<string, string>; inner: string }> = [];
  // Match paired <tag ...>...</tag> OR self-closing <tag ... />
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${localTagName}((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const attrStr = match[1] ?? '';
    const inner = match[2] ?? '';
    blocks.push({
      attributes: parseAttributes(attrStr),
      inner,
    });
  }
  return blocks;
}

const SUPPORTED_NODE_TAGS: Record<string, BpmnNodeType> = {
  startEvent: 'startEvent',
  endEvent: 'endEvent',
  serviceTask: 'serviceTask',
  userTask: 'userTask',
  exclusiveGateway: 'exclusiveGateway',
  parallelGateway: 'parallelGateway',
  inclusiveGateway: 'inclusiveGateway',
  task: 'task',
};

export class BpmnParser {
  public static parseXml(xmlString: string): BpmnProcessModel {
    if (!xmlString || typeof xmlString !== 'string' || xmlString.trim() === '') {
      throw new Error('Invalid XML: content is empty');
    }

    if (!/<(?:[a-zA-Z0-9_]+:)?definitions\b/i.test(xmlString)) {
      throw new Error('Invalid BPMN XML: root tag must be definitions');
    }

    const processBlocks = findXmlBlocks(xmlString, 'process');
    if (processBlocks.length === 0) {
      throw new Error('Invalid BPMN XML: missing process definition');
    }

    const processBlock = processBlocks[0];
    const processAttrs = processBlock.attributes;
    const processId = processAttrs['id'] || 'process_default';
    const processName = processAttrs['name'];
    const isExecutable = processAttrs['isExecutable'] !== 'false';

    const flowBlocks = findXmlBlocks(processBlock.inner, 'sequenceFlow');
    const flows: BpmnFlow[] = [];

    for (const fb of flowBlocks) {
      const flowId = fb.attributes['id'];
      const sourceRef = fb.attributes['sourceRef'];
      const targetRef = fb.attributes['targetRef'];

      if (!flowId || !sourceRef || !targetRef) {
        throw new Error(`Invalid sequenceFlow: missing id, sourceRef or targetRef`);
      }

      let conditionExpression: string | undefined;
      const conditionMatches = extractTagContent(fb.inner, 'conditionExpression');
      if (conditionMatches.length > 0) {
        conditionExpression = decodeXmlEntities(conditionMatches[0]);
      }

      flows.push({
        id: flowId,
        ...(fb.attributes['name'] ? { name: fb.attributes['name'] } : {}),
        sourceRef,
        targetRef,
        ...(conditionExpression !== undefined ? { conditionExpression } : {}),
      });
    }

    const nodes: BpmnNode[] = [];

    for (const [tag, nodeType] of Object.entries(SUPPORTED_NODE_TAGS)) {
      const tagBlocks = findXmlBlocks(processBlock.inner, tag);
      for (const tb of tagBlocks) {
        const id = tb.attributes['id'];
        if (!id) continue;

        const incoming = extractTagContent(tb.inner, 'incoming');
        const outgoing = extractTagContent(tb.inner, 'outgoing');

        let parameters: Record<string, string> | undefined;
        const inputParams = findXmlBlocks(tb.inner, 'inputParameter');
        if (inputParams.length > 0) {
          parameters = {};
          for (const param of inputParams) {
            const name = param.attributes['name'];
            if (name) {
              parameters[name] = decodeXmlEntities(param.inner.trim());
            }
          }
        }

        const node: BpmnNode = {
          id,
          type: nodeType,
          incoming,
          outgoing,
          ...(tb.attributes['name'] ? { name: tb.attributes['name'] } : {}),
          ...(tb.attributes['default'] ? { defaultFlow: tb.attributes['default'] } : {}),
          ...(parameters ? { parameters } : {}),
        };

        nodes.push(node);
      }
    }

    for (const flow of flows) {
      const srcNode = nodes.find((n) => n.id === flow.sourceRef);
      if (srcNode && !srcNode.outgoing.includes(flow.id)) {
        srcNode.outgoing.push(flow.id);
      }
      const tgtNode = nodes.find((n) => n.id === flow.targetRef);
      if (tgtNode && !tgtNode.incoming.includes(flow.id)) {
        tgtNode.incoming.push(flow.id);
      }
    }

    const shapes: Record<string, BpmnBounds> = {};
    const edges: Record<string, BpmnEdgeLayout> = {};

    const shapeBlocks = findXmlBlocks(xmlString, 'BPMNShape');
    for (const sb of shapeBlocks) {
      const bpmnElement = sb.attributes['bpmnElement'];
      if (!bpmnElement) continue;

      const boundsBlocks = findXmlBlocks(sb.inner, 'Bounds');
      if (boundsBlocks.length > 0) {
        const b = boundsBlocks[0].attributes;
        shapes[bpmnElement] = {
          x: Number(b['x'] ?? 0),
          y: Number(b['y'] ?? 0),
          width: Number(b['width'] ?? 0),
          height: Number(b['height'] ?? 0),
        };
      }
    }

    const edgeBlocks = findXmlBlocks(xmlString, 'BPMNEdge');
    for (const eb of edgeBlocks) {
      const bpmnElement = eb.attributes['bpmnElement'];
      if (!bpmnElement) continue;

      const waypointBlocks = findXmlBlocks(eb.inner, 'waypoint');
      const waypoints: BpmnWaypoint[] = waypointBlocks.map((wb) => ({
        x: Number(wb.attributes['x'] ?? 0),
        y: Number(wb.attributes['y'] ?? 0),
      }));

      edges[bpmnElement] = { waypoints };
    }

    const layout: BpmnDiagramLayout | undefined =
      Object.keys(shapes).length > 0 || Object.keys(edges).length > 0
        ? { shapes, edges }
        : undefined;

    return {
      id: processId,
      ...(processName ? { name: processName } : {}),
      isExecutable,
      nodes,
      flows,
      ...(layout ? { layout } : {}),
    };
  }
}

export function parseBpmnXml(xmlString: string): BpmnProcessModel {
  return BpmnParser.parseXml(xmlString);
}
