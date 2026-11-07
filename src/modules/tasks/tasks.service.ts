import type { FarmTask, FarmTaskRow } from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { fromPostgrest, notFound } from '../../shared/errors';
import { assertOwnsFarm, listOwnedFarmIds } from '../../shared/ownership';

const today = (): string => new Date().toISOString().slice(0, 10);

function toTask(row: FarmTaskRow): FarmTask {
  return {
    id: row.id,
    farmId: row.farm_id,
    cropId: row.crop_id,
    taskType: row.task_type,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    completedDate: row.completed_date,
    // The table has no scheduled job to age tasks, so overdue is derived on read.
    status: row.status === 'pending' && row.due_date < today() ? 'overdue' : row.status,
    actionData: row.action_data,
    createdAt: row.created_at,
  };
}

export const tasksService = {
  /** Open tasks, soonest first. Completed and skipped work is excluded. */
  async listOpen(farmerId: string, farmId?: string, limit = 20): Promise<FarmTask[]> {
    const farmIds = farmId ? [(await assertOwnsFarm(farmerId, farmId)).id] : await listOwnedFarmIds(farmerId);
    if (farmIds.length === 0) return [];

    const { data, error } = await db
      .from('farm_tasks')
      .select('*')
      .in('farm_id', farmIds)
      .not('status', 'in', '("completed","skipped")')
      .order('due_date', { ascending: true })
      .limit(limit);
    if (error) throw fromPostgrest(error, 'List tasks');
    return (data ?? []).map((row) => toTask(row as FarmTaskRow));
  },

  async complete(farmerId: string, taskId: string): Promise<FarmTask> {
    const farmIds = await listOwnedFarmIds(farmerId);
    const { data, error } = await db
      .from('farm_tasks')
      .update({ status: 'completed', completed_date: today() })
      .eq('id', taskId)
      .in('farm_id', farmIds) // ownership enforced in the predicate
      .select('*')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Complete task');
    if (!data) throw notFound('Task not found');
    return toTask(data as FarmTaskRow);
  },

  async skip(farmerId: string, taskId: string): Promise<FarmTask> {
    const farmIds = await listOwnedFarmIds(farmerId);
    const { data, error } = await db
      .from('farm_tasks')
      .update({ status: 'skipped' })
      .eq('id', taskId)
      .in('farm_id', farmIds)
      .select('*')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Skip task');
    if (!data) throw notFound('Task not found');
    return toTask(data as FarmTaskRow);
  },

  async create(
    farmerId: string,
    payload: { farmId: string; cropId?: string; title: string; description?: string; dueDate: string; taskType?: string },
  ): Promise<FarmTask> {
    await assertOwnsFarm(farmerId, payload.farmId);
    const { data, error } = await db
      .from('farm_tasks')
      .insert({
        farm_id: payload.farmId,
        crop_id: payload.cropId ?? null,
        title: payload.title,
        description: payload.description ?? null,
        due_date: payload.dueDate,
        task_type: payload.taskType ?? null,
      })
      .select('*')
      .single();
    if (error) throw fromPostgrest(error, 'Create task');
    return toTask(data as FarmTaskRow);
  },
};
