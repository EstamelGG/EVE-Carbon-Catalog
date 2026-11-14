"""Batch Blender key writes and evaluate original Granny spline segments."""
import inspect


def import_animations_batched(importer, *args, **kwargs):
    pending = {}
    original_gr2 = 'cmfVersion' not in args[0]

    def insert(bone, *, data_path, frame, group):
        action = bone.id_data.animation_data.action
        path = bone.path_from_id(data_path)
        key = (action, path)
        if key not in pending:
            # Let Blender create the correct action slot/channel bag once.
            bone.keyframe_insert(data_path=data_path, frame=frame, group=group)
            pending[key] = []
        pending[key].append((frame, tuple(getattr(bone, data_path))))
        return True

    def curves(action):
        for curve in importer._action_fcurves(action):
            values = pending.get((action, curve.data_path))
            if values:
                points = curve.keyframe_points
                points.clear()
                points.add(len(values))
                points.foreach_set('co', [v for frame, lanes in values for v in (frame, lanes[curve.array_index])])
                curve.update()
            yield curve
        for key in [key for key in pending if key[0] == action]:
            del pending[key]

    from carbon_gr2.curves import sample_curve

    def sample(curve, time, duration, fallback, default):
        # Format 2 is the identity sentinel; the Blender importer handles its
        # rest transform and legacy fixture graphs without expanded controls.
        if (not original_gr2 or not isinstance(curve.get('format'), int) or curve['format'] == 2
                or not curve.get('controls') or not curve.get('knots')):
            return fallback()
        return list(sample_curve(list(default), curve, time, duration=duration,
                                 keyframed=curve.get('format') == 0))

    source = inspect.getsource(importer.import_animations)
    replacements = (
        ('pc', 'def_pos3', '_eval_vec_curve(pos_times, pos_vals, t, def_pos3, pc.get("degree", 1))'),
        ('oc', 'def_rot4', '_eval_quat_curve_xyzw(rot_times, rot_vals, t, def_rot4, oc.get("degree", 1))'),
        ('sc', 'def_ss9', '_eval_vec_curve(ss_times, ss_vals, t, def_ss9, sc.get("degree", 1))'),
    )
    for curve, default, expression in replacements:
        if source.count(expression) != 1:
            raise ValueError('Animation importer no longer exposes the expected source curve boundary')
        source = source.replace(expression,
                                f'_source_sample({curve}, t, duration, lambda: {expression}, {default})')

    # Blender edit bones store an orthonormal bind frame. Inverting a scaled
    # Granny bind matrix here would divide translation by the bone's own
    # scale (e.g. 8.7081 for CT1 ElevR01). Preserve the rigid-frame offset.
    location = 'loc = delta.to_translation()'
    if source.count(location) != 1:
        raise ValueError('Animation importer no longer exposes the expected bind translation')
    if original_gr2:
        source = source.replace(location, 'loc = (_quat_xyzw_to_mathutils(def_rot4).normalized().inverted() @ '
                            '(anim_local.to_translation() - restM.to_translation()))')
    if source.count('pb.keyframe_insert(') != 3 or source.count('_action_fcurves(action)') != 1:
        raise ValueError('Animation importer changed; review the batched key writer')
    source = source.replace('pb.keyframe_insert(', '_batch_insert(pb,').replace('_action_fcurves(action)', '_batch_curves(action)')
    namespace = dict(importer.import_animations.__globals__, _source_sample=sample, _batch_insert=insert, _batch_curves=curves)
    exec(compile(source, '<batched animation importer>', 'exec'), namespace)
    return namespace['import_animations'](*args, **kwargs)
