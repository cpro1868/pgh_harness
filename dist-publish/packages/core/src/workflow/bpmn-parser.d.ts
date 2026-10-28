export type BpmnNodeType = 'startEvent' | 'endEvent' | 'serviceTask' | 'userTask' | 'exclusiveGateway' | 'parallelGateway' | 'inclusiveGateway' | 'task';
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
export declare class BpmnParser {
    static parseXml(xmlString: string): BpmnProcessModel;
}
export declare function parseBpmnXml(xmlString: string): BpmnProcessModel;
