function decodeXmlEntities(val) {
    return val
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
function parseAttributes(attrString) {
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = attrRegex.exec(attrString)) !== null) {
        const key = match[1];
        const value = match[2] !== undefined ? match[2] : match[3] ?? '';
        attrs[key] = decodeXmlEntities(value);
    }
    return attrs;
}
function extractTagContent(content, localTagName) {
    const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${localTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>`, 'g');
    const results = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        results.push(match[1].trim());
    }
    return results;
}
function findXmlBlocks(content, localTagName) {
    const blocks = [];
    // Match paired <tag ...>...</tag> OR self-closing <tag ... />
    const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${localTagName}((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>)`, 'gi');
    let match;
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
const SUPPORTED_NODE_TAGS = {
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
    static parseXml(xmlString) {
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
        const flows = [];
        for (const fb of flowBlocks) {
            const flowId = fb.attributes['id'];
            const sourceRef = fb.attributes['sourceRef'];
            const targetRef = fb.attributes['targetRef'];
            if (!flowId || !sourceRef || !targetRef) {
                throw new Error(`Invalid sequenceFlow: missing id, sourceRef or targetRef`);
            }
            let conditionExpression;
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
        const nodes = [];
        for (const [tag, nodeType] of Object.entries(SUPPORTED_NODE_TAGS)) {
            const tagBlocks = findXmlBlocks(processBlock.inner, tag);
            for (const tb of tagBlocks) {
                const id = tb.attributes['id'];
                if (!id)
                    continue;
                const incoming = extractTagContent(tb.inner, 'incoming');
                const outgoing = extractTagContent(tb.inner, 'outgoing');
                let parameters;
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
                const node = {
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
        const shapes = {};
        const edges = {};
        const shapeBlocks = findXmlBlocks(xmlString, 'BPMNShape');
        for (const sb of shapeBlocks) {
            const bpmnElement = sb.attributes['bpmnElement'];
            if (!bpmnElement)
                continue;
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
            if (!bpmnElement)
                continue;
            const waypointBlocks = findXmlBlocks(eb.inner, 'waypoint');
            const waypoints = waypointBlocks.map((wb) => ({
                x: Number(wb.attributes['x'] ?? 0),
                y: Number(wb.attributes['y'] ?? 0),
            }));
            edges[bpmnElement] = { waypoints };
        }
        const layout = Object.keys(shapes).length > 0 || Object.keys(edges).length > 0
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
export function parseBpmnXml(xmlString) {
    return BpmnParser.parseXml(xmlString);
}
