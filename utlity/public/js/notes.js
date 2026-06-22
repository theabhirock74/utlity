(function patch_global_form_handlers() {
	if (frappe.ui.form._notes_widget_handlers_patched) {
		return;
	}

	if (!frappe.ui.form.ScriptManager?.prototype?.get_handlers) {
		frappe.ready(patch_global_form_handlers);
		return;
	}

	frappe.ui.form._notes_widget_handlers_patched = true;

	const original_get_handlers =
		frappe.ui.form.ScriptManager.prototype.get_handlers;

	frappe.ui.form.ScriptManager.prototype.get_handlers = function (
		event_name,
		doctype
	) {
		const handlers = original_get_handlers.call(this, event_name, doctype);
		const wildcard_handlers =
			frappe.ui.form.handlers["*"]?.[event_name] || [];

		wildcard_handlers.forEach((fn) => {
			handlers.new_style.push(fn);
		});

		return handlers;
	};
})();

frappe.ui.NotesWidget = class NotesWidget {
	constructor(frm, options = {}) {
		this.frm = frm;

		this.options = {
			html_field: "note_html",
			notes_doctype: "Notes",
			default_values: {},
			display_fields: null,
			auto_render: true,
			...options,
		};
		frm._notes_widget = this;

		if (this.options.auto_render) {
			this.render();
		}
	}

	static has_active_workflow(doctype) {
		frappe.workflow.setup(doctype);
		return Boolean(frappe.workflow.workflows[doctype]);
	}

	static get_workflow_state(frm) {
		const state_field = frappe.workflow.get_state_fieldname(frm.doctype);
		if (!state_field) {
			return null;
		}

		return (
			frm.doc[state_field] ||
			frappe.workflow.get_default_state(frm.doctype, frm.doc.docstatus)
		);
	}

	is_doc_saved() {
		return !this.frm.is_new() && this.frm.doc.name;
	}

	async require_note_for_workflow_action() {
		if (
			!frappe.ui.NotesWidget.has_active_workflow(this.frm.doctype) ||
			!this.is_doc_saved()
		) {
			return;
		}

		await frappe.model.with_doctype(this.options.notes_doctype);
		const meta = frappe.get_meta(this.options.notes_doctype);

		return new Promise((resolve, reject) => {
			this.open_dialog(meta, {
				action: this.frm.selected_workflow_action,
				workflow_state: frappe.ui.NotesWidget.get_workflow_state(this.frm),
				resolve,
				reject,
			});
		});
	}

	async render() {
		const wrapper =
			this.frm.fields_dict[this.options.html_field]?.$wrapper;

		if (!wrapper) {
			return;
		}

		if (!this.is_doc_saved()) {
			wrapper.html(`
				<div class="text-center text-muted py-4">
					${__("Please save the document first to view or add notes.")}
				</div>
			`);
			return;
		}

		await frappe.model.with_doctype(this.options.notes_doctype);

		const meta = frappe.get_meta(this.options.notes_doctype);

		const fieldnames = [
			"name",
			"owner",
			"creation",
			...meta.fields.map((df) => df.fieldname),
		];

		const notes = await frappe.db.get_list(this.options.notes_doctype, {
			fields: fieldnames,
			filters: {
				ref_doctype: this.frm.doctype,
				ref_doc: this.frm.doc.name,
			},
			order_by: "creation desc",
		});

		let html = `
			<div class="d-flex justify-content-end mb-3">
				<button class="btn btn-primary btn-sm add-note-btn">
					Add Note
				</button>
			</div>
		`;

		if (!notes.length) {
			html += `
				<div class="text-center text-muted py-4">
					No Notes Found
				</div>
			`;
		}

		notes.forEach((note) => {
			const initial = (note.owner || "U").charAt(0).toUpperCase();

			let fields_html = "";

			meta.fields.forEach((df) => {
				if (
					[
						"Section Break",
						"Column Break",
						"Tab Break",
						"HTML",
						"Button",
					].includes(df.fieldtype)
				) {
					return;
				}
				if (["ref_doctype", "ref_doc"].includes(df.fieldname)) {
					return;
				}

				const value = note[df.fieldname];

				if (value === null || value === undefined || value === "") {
					return;
				}

				fields_html += `
					<div style="margin-bottom:6px;">
						<span style="font-weight:600;">
							${df.label || df.fieldname}:
						</span>
						<span>
							${frappe.utils.escape_html(String(value))}
						</span>
					</div>
				`;
			});

			html += `
				<div style="
					border:1px solid #e5e7eb;
					border-radius:8px;
					padding:12px;
					margin-bottom:12px;
					background:#fff;
				">

					<div style="
						display:flex;
						align-items:flex-start;
					">

						<div style="
							width:40px;
							height:40px;
							min-width:40px;
							border-radius:50%;
							background:#dff5e1;
							color:#2e7d32;
							display:flex;
							align-items:center;
							justify-content:center;
							font-weight:600;
							margin-right:12px;
						">
							${initial}
						</div>

						<div style="flex:1;">

							<div style="
								font-weight:600;
								margin-bottom:2px;
							">
								${note.owner}
							</div>

							<div style="
								font-size:12px;
								color:#6c7680;
								margin-bottom:10px;
							">
								${frappe.datetime.str_to_user(note.creation)}
							</div>

							${fields_html}

						</div>

					</div>

				</div>
			`;
		});

		wrapper.html(html);

		wrapper.find(".add-note-btn").on("click", () => {
			this.open_dialog(meta);
		});
	}

	get_workflow_state_for_note() {
		if (!frappe.ui.NotesWidget.has_active_workflow(this.frm.doctype)) {
			return null;
		}

		return frappe.ui.NotesWidget.get_workflow_state(this.frm);
	}

	abort_workflow_note_dialog(d, workflow_options) {
		if (workflow_options._aborted) {
			return;
		}

		workflow_options._aborted = true;
		d.hide();
		frappe.dom.unfreeze();
		this.frm.selected_workflow_action = null;
		frappe.validated = false;
		workflow_options.reject(
			new Error("Note is required for workflow action")
		);
	}

	open_dialog(meta, workflow_options = null) {
		if (!this.is_doc_saved()) {
			frappe.show_alert({
				message: __("Please save the document first to add notes."),
				indicator: "orange",
			});

			if (workflow_options) {
				this.abort_workflow_note_dialog(
					{ hide: () => {} },
					workflow_options
				);
			}
			return;
		}

		const is_workflow = Boolean(workflow_options);
		const fields = [];

		meta.fields.forEach((df) => {
			if (
				[
					"Section Break",
					"Column Break",
					"Tab Break",
					"HTML",
					"Button",
				].includes(df.fieldtype)
			) {
				return;
			}
			if (df.hidden) {
				return;
			}

			fields.push({
				fieldname: df.fieldname,
				label: df.label,
				fieldtype: df.fieldtype,
				reqd:
					is_workflow && df.fieldname === "notes" ? 1 : df.reqd,
			});
		});

		const dialog_title = is_workflow
			? __("Add Note for {0}", [workflow_options.action])
			: __("Add Note");

		const d = new frappe.ui.Dialog({
			title: dialog_title,
			size: "small",
			fields,
			static: is_workflow,

			primary_action_label: __("Save"),

			primary_action: async (values) => {
				const doc = {
					doctype: this.options.notes_doctype,
					ref_doctype: this.frm.doctype,
					ref_doc: this.frm.doc.name,
					...this.options.default_values,
					...values,
				};

				const workflow_state =
					(is_workflow && workflow_options.workflow_state) ||
					this.get_workflow_state_for_note();

				if (workflow_state) {
					doc.doc_workflow_state = workflow_state;
				}

				await frappe.call({
					method: "frappe.client.insert",
					args: { doc },
				});

				frappe.show_alert({
					message: __("Note Added"),
					indicator: "green",
				});

				d._note_saved = true;
				d.hide();

				if (this.frm.fields_dict[this.options.html_field]) {
					await this.render();
				}

				if (is_workflow) {
					frappe.dom.freeze();
					workflow_options.resolve();
				}
			},
		});

		if (is_workflow) {
			frappe.dom.unfreeze();

			d.set_secondary_action_label(__("Cancel"));
			d.set_secondary_action(() => {
				this.abort_workflow_note_dialog(d, workflow_options);
			});

			d.onhide = () => {
				if (!d._note_saved && !workflow_options._aborted) {
					this.abort_workflow_note_dialog(d, workflow_options);
				}
			};
		}

		d.show();
	}
};

// i want to show where the notes doctype is enabled or not
frappe.ui.form.on("*", {
	refresh(frm) {
		// Widget not enabled for this doctype
		if (!frm._notes_widget) {
			return;
		}

		frm._notes_widget.render();
	},

	async before_workflow_action(frm) {
		// Notes widget not enabled
		if (!frm._notes_widget) {
			return;
		}

		if (
			!frappe.ui.NotesWidget.has_active_workflow(frm.doctype) ||
			frm.doc.__islocal
		) {
			return;
		}

		try {
			await frm._notes_widget.require_note_for_workflow_action();
		} catch (e) {
			frappe.dom.unfreeze();
			frm.selected_workflow_action = null;
			frappe.validated = false;
			throw e;
		}
	},
});