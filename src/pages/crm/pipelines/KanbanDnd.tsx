import type {ReactNode} from 'react';
import {DndContext,KeyboardSensor,PointerSensor,closestCenter,useSensor,useSensors,useDroppable,useDraggable,type DragEndEvent} from '@dnd-kit/core';
import {CSS} from '@dnd-kit/utilities';

export function PipelineDragContext({enabled,onMove,children}:{
  enabled:boolean;onMove:(recordId:string,stageId:string)=>void;children:ReactNode;
}){
  const pointer=useSensor(PointerSensor,{activationConstraint:{distance:7}});
  const keyboard=useSensor(KeyboardSensor);
  const sensors=useSensors(pointer,keyboard);
  const finish=({active,over}:DragEndEvent)=>{
    if(enabled&&over&&String(active.id)!==String(over.id)){
      onMove(String(active.id),String(over.id));
    }
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finish}>{children}</DndContext>;
}

export function KanbanStageDrop({id,enabled,children}:{
  id:string;enabled:boolean;children:ReactNode;
}){
  const {setNodeRef,isOver}=useDroppable({id,disabled:!enabled});
  return <div ref={setNodeRef} className={isOver?'rounded-lg ring-2 ring-primary ring-offset-2':''}>{children}</div>;
}
export function KanbanRecordDrag({id,enabled,children}:{
  id:string;enabled:boolean;children:ReactNode;
}){
  const {setNodeRef,listeners,attributes,transform,isDragging}=useDraggable({id,disabled:!enabled});
  return <div ref={setNodeRef}
    style={{transform:CSS.Translate.toString(transform),opacity:isDragging?.55:1,position:'relative'}}
    className="rounded-lg border bg-background p-3 space-y-2">
    {enabled&&<button type="button" {...listeners} {...attributes}
      className="touch-none cursor-grab rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      aria-label="Drag record to another pipeline stage">
      Drag <span aria-hidden="true">⋮⋮</span>
    </button>}
    {children}
  </div>;
}
