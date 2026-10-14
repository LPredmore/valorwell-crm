import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
import {useDebouncedValue} from './useDebouncedValue';

describe('CRM global search debounce',()=>{
  beforeEach(()=>vi.useFakeTimers());
  afterEach(()=>vi.useRealTimers());
  it('returns the deep-linked initial URL search immediately',()=>{
    const {result}=renderHook(()=>useDebouncedValue('initial',350));
    expect(result.current).toBe('initial');
  });
  it('waits 350 ms of inactivity before issuing the new query value',()=>{
    const {result,rerender}=renderHook(({value})=>useDebouncedValue(value,350),{
      initialProps:{value:''},
    });
    rerender({value:'vet'});
    act(()=>vi.advanceTimersByTime(300));
    expect(result.current).toBe('');
    rerender({value:'veteran'});
    act(()=>vi.advanceTimersByTime(349));
    expect(result.current).toBe('');
    act(()=>vi.advanceTimersByTime(1));
    expect(result.current).toBe('veteran');
  });
  it('cancels pending request on filter reset and never emits stale search terms',()=>{
    const {result,rerender}=renderHook(({value})=>useDebouncedValue(value,350),{
      initialProps:{value:'start'},
    });
    rerender({value:'outdated'});
    act(()=>vi.advanceTimersByTime(150));
    rerender({value:''});
    act(()=>vi.advanceTimersByTime(350));
    expect(result.current).toBe('');
  });
});
