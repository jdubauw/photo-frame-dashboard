UPDATE settings SET value=json_set(value,'$.homeControls',json('false')) WHERE id=1;
