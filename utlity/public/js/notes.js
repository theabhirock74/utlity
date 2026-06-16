console.log("NotesWidget2");
frappe.ui.NotesWidget = class NotesWidget {
    constructor(frm, options = {}) {
        this.frm = frm;
    
        this.options = {
            html_field: "note_html",
            notes_doctype: "Notes",
            default_values: {},
            display_fields: null,
            ...options
        };
    
        this.render();
    }

	is_doc_saved() {
		return !this.frm.is_new() && this.frm.doc.name;
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
			...meta.fields.map(df => df.fieldname)
		];

		const notes = await frappe.db.get_list(
			this.options.notes_doctype,
			{
				fields: fieldnames,
				filters: {
					ref_doctype: this.frm.doctype,
					ref_doc: this.frm.doc.name
				},
				order_by: "creation desc"
			}
		);

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

		notes.forEach(note => {

			const initial = (note.owner || "U")
				.charAt(0)
				.toUpperCase();

			let fields_html = "";

			meta.fields.forEach(df => {

				if (
					[
						"Section Break",
						"Column Break",
						"Tab Break",
						"HTML",
						"Button"
					].includes(df.fieldtype)
				) {
					return;
				}
				if (
					[
						"ref_doctype",
						"ref_doc"
					].includes(df.fieldname)
				) {
					return;
				}

				const value = note[df.fieldname];

				if (
					value === null ||
					value === undefined ||
					value === ""
				) {
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
								${frappe.datetime.str_to_user(
									note.creation
								)}
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

	open_dialog(meta) {
		if (!this.is_doc_saved()) {
			frappe.show_alert({
				message: __("Please save the document first to add notes."),
				indicator: "orange"
			});
			return;
		}

		const fields = [];

		meta.fields.forEach(df => {

			if (
				[
					"Section Break",
					"Column Break",
					"Tab Break",
					"HTML",
					"Button"
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
				reqd: df.reqd
			});
		});

		const d = new frappe.ui.Dialog({
			title: __("Add Note"),
			size: "small",
			fields,

			primary_action_label: __("Save"),

			primary_action: async values => {

                const doc = {
                    doctype: this.options.notes_doctype,
                    ref_doctype: this.frm.doctype,
                    ref_doc: this.frm.doc.name,
                
                    ...this.options.default_values,
                    ...values
                };

				await frappe.call({
					method: "frappe.client.insert",
					args: { doc }
				});

				frappe.show_alert({
					message: __("Note Added"),
					indicator: "green"
				});

				d.hide();

				this.render();
			}
		});

		d.show();
	}
};