from fastapi import APIRouter, HTTPException, Query, Request

from shared.contracts import LineageGraph, LineageNode

router = APIRouter(prefix="/lineage", tags=["lineage"])


@router.get("", response_model=LineageGraph)
def get_graph(request: Request, anchor: str | None = None) -> LineageGraph:
    try:
        return request.app.state.lineage_service.get_lineage_graph(anchor)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/upstream/{node_id}", response_model=list[LineageNode])
def get_upstream(node_id: str, request: Request) -> list[LineageNode]:
    try:
        return request.app.state.lineage_service.get_upstream(node_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/downstream/{node_id}", response_model=list[LineageNode])
def get_downstream(node_id: str, request: Request) -> list[LineageNode]:
    try:
        return request.app.state.lineage_service.get_downstream(node_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/paths", response_model=list[list[str]])
def get_paths(
    request: Request,
    source: str,
    target: str,
    max_paths: int = Query(default=100, ge=1, le=1000),
    max_depth: int | None = Query(default=None, ge=1, le=500),
) -> list[list[str]]:
    try:
        return request.app.state.lineage_service.get_paths(
            source, target, max_paths=max_paths, max_depth=max_depth
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/blast-radius/{node_id}", response_model=list[LineageNode])
def get_blast_radius(node_id: str, request: Request) -> list[LineageNode]:
    try:
        return request.app.state.lineage_service.calculate_blast_radius(node_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
