export interface IPathNode {
  type: 'User' | 'Transaction';
  properties: any; 
}

export interface IPathRelationship {
  type: 'SENT' | 'RECEIVED_BY';
  startNodeId: string;
  endNodeId: string;
}

export interface IShortestPathResult {
  path: {
    nodes: IPathNode[];
    relationships: IPathRelationship[];
  };
  length: number; 
}
